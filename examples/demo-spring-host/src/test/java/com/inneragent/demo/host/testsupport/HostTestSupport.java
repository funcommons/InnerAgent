package com.inneragent.demo.host.testsupport;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 冒烟测试支撑(与 starter testsupport 同款最小实现,宿主侧独立重写):
 * ① 本地 JWKS 端点(starter 的 server-base 指向它);② 主服务同形 act token
 * 签发器(RS256 + RFC 8693 claims + kid=公钥 DER SHA-256 Base64URL 前 16 位);
 * ③ 裸 JSON-RPC POST 助手(stateless /ia-mcp 兼容无会话请求)。
 */
public final class HostTestSupport {

    private HostTestSupport() {
    }

    /** 最小 JWKS 端点(stub 主服务 /.well-known/jwks.json)。 */
    public static final class JwksServer {

        private final ObjectMapper mapper = new ObjectMapper();
        private final AtomicReference<String> body = new AtomicReference<>("{\"keys\":[]}");
        private HttpServer server;

        public void start() throws IOException {
            this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            this.server.createContext("/.well-known/jwks.json", exchange -> {
                byte[] payload = this.body.get().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, payload.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(payload);
                }
            });
            this.server.start();
        }

        public void stop() {
            if (this.server != null) {
                this.server.stop(0);
                this.server = null;
            }
        }

        public void setKeys(RSAKey... keys) throws IOException {
            List<Object> jsonKeys = new ArrayList<>();
            for (RSAKey key : keys) {
                jsonKeys.add(key.toJSONObject());
            }
            this.body.set(this.mapper.writeValueAsString(Map.of("keys", jsonKeys)));
        }

        public String base() {
            return "http://127.0.0.1:" + this.server.getAddress().getPort();
        }

    }

    /** 主服务 ActTokenIssuer 同形签发器(iss=inneragent、aud=注册 endpoint_url)。 */
    public static final class ActTokens {

        private final KeyPair keyPair;
        private final String kid;
        private final String audience;

        public ActTokens(String audience) {
            this.audience = audience;
            this.keyPair = generateKeyPair();
            this.kid = kidOf((RSAPublicKey) this.keyPair.getPublic());
        }

        public RSAKey publicJwk() {
            return new RSAKey.Builder((RSAPublicKey) this.keyPair.getPublic()).keyID(this.kid).build();
        }

        public String issue(String sub, String runId) {
            return issue(sub, runId, Map.of());
        }

        /** claims 覆写:值为 null 移除该 claim(错 aud/缺 act 用例)。 */
        public String issue(String sub, String runId, Map<String, Object> overrides) {
            Map<String, Object> claims = new LinkedHashMap<>();
            claims.put("iss", "inneragent");
            claims.put("sub", sub);
            claims.put("aud", List.of(this.audience));
            claims.put("exp", Date.from(Instant.now().plusSeconds(60)));
            claims.put("iat", Date.from(Instant.now()));
            claims.put("act", Map.of("sub", "inneragent-run:" + runId));
            claims.put("appKey", "demo-app");
            claims.put("tenantId", 7);
            claims.put("toolName", "mcp__demo-spring-host__create_host_record");
            overrides.forEach((key, value) -> {
                if (value == null) {
                    claims.remove(key);
                }
                else {
                    claims.put(key, value);
                }
            });
            JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder();
            claims.forEach(builder::claim);
            SignedJWT jwt = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(this.kid).build(), builder.build());
            try {
                jwt.sign(new RSASSASigner(this.keyPair.getPrivate()));
                return jwt.serialize();
            }
            catch (JOSEException signingFailure) {
                throw new IllegalStateException("测试 act token 签发失败", signingFailure);
            }
        }

        /** 与主服务 ActTokenKeyManager.kidOf 相同推导。 */
        static String kidOf(RSAPublicKey publicKey) {
            try {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(publicKey.getEncoded());
                return Base64.getUrlEncoder().withoutPadding().encodeToString(digest).substring(0, 16);
            }
            catch (GeneralSecurityException digestFailure) {
                throw new IllegalStateException(digestFailure);
            }
        }

        static KeyPair generateKeyPair() {
            try {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
                generator.initialize(2048);
                return generator.generateKeyPair();
            }
            catch (GeneralSecurityException generationFailure) {
                throw new IllegalStateException(generationFailure);
            }
        }

    }

    /** 裸 JSON-RPC 客户端(stateless 表面:无 initialize 前置亦可 tools/call)。 */
    public static final class RawMcp {

        private static final HttpClient HTTP = HttpClient.newBuilder()
                .connectTimeout(java.time.Duration.ofSeconds(5))
                .build();

        public static HttpResponse<String> post(String url, String actToken, String jsonRpcBody) throws Exception {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(java.time.Duration.ofSeconds(10))
                    .header("Accept", "application/json, text/event-stream")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonRpcBody, StandardCharsets.UTF_8));
            if (actToken != null) {
                builder.header("X-IA-Act", actToken);
            }
            return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }

        public static String toolsList() {
            return "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}";
        }

        public static String toolsCall(String toolName, Map<String, Object> arguments) throws IOException {
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("name", toolName);
            params.put("arguments", arguments);
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("jsonrpc", "2.0");
            request.put("id", 2);
            request.put("method", "tools/call");
            request.put("params", params);
            return new ObjectMapper().writeValueAsString(request);
        }

    }

}
