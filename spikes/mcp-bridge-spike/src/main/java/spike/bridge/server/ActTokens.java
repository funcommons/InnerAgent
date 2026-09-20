package spike.bridge.server;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Spike stand-in for the act token machinery (starter responsibility ①).
 *
 * The production format is a real RS256 JWT with RFC 8693 claims (sub, act.sub, aud, exp 60s)
 * verified against InnerAgent's JWKS. Crypto is out of scope for a bridge spike: here we only
 * model the CLAIMS SHAPE and the header transport, because the questions under test are
 * "where does the header enter the server" and "how does it reach tool handlers" - not
 * signature math (JDK/Jose libraries handle that; zero MCP-SDK coupling).
 *
 * Wire format: "spike-header." + base64url(payloadJson) + "." + "stub-signature"
 */
public final class ActTokens {

	public static final String HEADER = "X-IA-Act";

	private static final String PREFIX = "spike-header.";

	private static final ObjectMapper MAPPER = new ObjectMapper();

	private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
	};

	private ActTokens() {
	}

	public static String issue(String sub, String actSub, String runId) {
		Map<String, Object> claims = new LinkedHashMap<>();
		claims.put("iss", "inneragent-spike");
		claims.put("sub", sub);
		Map<String, Object> act = new LinkedHashMap<>();
		act.put("sub", actSub);
		claims.put("act", act);
		if (runId != null) {
			claims.put("runId", runId);
		}
		try {
			String json = MAPPER.writeValueAsString(claims);
			String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
			return PREFIX + payload + ".stub-signature";
		}
		catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
			throw new IllegalStateException("cannot serialize act token claims", ex);
		}
	}

	/** Returns the parsed claims map, or null if the header is absent/malformed. */
	public static Map<String, Object> parse(String headerValue) {
		if (headerValue == null || !headerValue.startsWith(PREFIX)) {
			return null;
		}
		String[] parts = headerValue.split("\\.");
		if (parts.length != 3) {
			return null;
		}
		try {
			String json = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
			return MAPPER.readValue(json, MAP_TYPE);
		}
		catch (Exception ex) {
			return null;
		}
	}

}
