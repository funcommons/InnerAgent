package com.inneragent.starter.config;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 桥配置(前缀 {@code inneragent.bridge.*})。
 */
@ConfigurationProperties(prefix = "inneragent.bridge")
public class IaBridgeProperties {

	/** 总开关(false 时不装配任何桥组件) */
	private boolean enabled = true;

	/**
	 * InnerAgent 主服务地址(serverBase),JWKS 拉取与回调转发基址。
	 * 未配置:启动 WARN 不阻断;JWKS 不可达 → /ia-mcp 全量 401 fail-closed。
	 */
	private String serverBase;

	/** 桥 MCP 端点(stateless 形态) */
	private String endpoint = "/ia-mcp";

	/** MCP serverInfo 名称(主服务注册宿主 MCP 端点时可见) */
	private String serverName = "inneragent-host-bridge";

	/** 额外扫描 @IaTool 的包;已注册为 bean 的宿主工具类无需配置 */
	private List<String> toolPackages = new ArrayList<>();

	private final Scan scan = new Scan();

	private final Act act = new Act();

	public boolean isEnabled() {
		return this.enabled;
	}

	public void setEnabled(boolean enabled) {
		this.enabled = enabled;
	}

	public String getServerBase() {
		return this.serverBase;
	}

	public void setServerBase(String serverBase) {
		this.serverBase = serverBase;
	}

	public String getEndpoint() {
		return this.endpoint;
	}

	public void setEndpoint(String endpoint) {
		this.endpoint = endpoint;
	}

	public String getServerName() {
		return this.serverName;
	}

	public void setServerName(String serverName) {
		this.serverName = serverName;
	}

	public List<String> getToolPackages() {
		return this.toolPackages;
	}

	public void setToolPackages(List<String> toolPackages) {
		this.toolPackages = toolPackages;
	}

	public Scan getScan() {
		return this.scan;
	}

	public Act getAct() {
		return this.act;
	}

	/** 工具扫描行为 */
	public static class Scan {

		/** 扫描失败(重复工具名/schema 生成失败等)是否阻断启动 */
		private boolean failFast = true;

		public boolean isFailFast() {
			return this.failFast;
		}

		public void setFailFast(boolean failFast) {
			this.failFast = failFast;
		}

	}

	/** act token 验签行为 */
	public static class Act {

		/** JWKS 路径(挂 serverBase 之后,对齐主服务 /.well-known/jwks.json) */
		private String jwksPath = "/.well-known/jwks.json";

		/** JWKS 周期刷新间隔 */
		private Duration cacheTtl = Duration.ofMinutes(5);

		/**
		 * 轮换宽限:key 从最新 JWKS 消失后本地保留时长,默认 72h
		 * (对齐主服务 ActTokenKeyManager GRACE_PERIOD,宿主侧过渡验签)。
		 */
		private Duration keyRetention = Duration.ofHours(72);

		/** 未知 kid 触发强制刷新的最小间隔(防未知 kid 洪水放大拉取) */
		private Duration forcedRefreshCooldown = Duration.ofSeconds(5);

		/** 期望 iss(主服务 ActTokenIssuer.ISSUER) */
		private String issuer = "inneragent";

		/**
		 * 期望 aud(宿主 MCP URI,audience 绑定)。
		 * TODO(P1 收口对齐):默认占位值,宿主按注册到主服务的 MCP URI 配置。
		 */
		private List<String> audiences = List.of("ia-mcp");

		/** exp/nbf 校验的时钟偏移容忍 */
		private Duration clockSkew = Duration.ofSeconds(30);

		public String getJwksPath() {
			return this.jwksPath;
		}

		public void setJwksPath(String jwksPath) {
			this.jwksPath = jwksPath;
		}

		public Duration getCacheTtl() {
			return this.cacheTtl;
		}

		public void setCacheTtl(Duration cacheTtl) {
			this.cacheTtl = cacheTtl;
		}

		public Duration getKeyRetention() {
			return this.keyRetention;
		}

		public void setKeyRetention(Duration keyRetention) {
			this.keyRetention = keyRetention;
		}

		public Duration getForcedRefreshCooldown() {
			return this.forcedRefreshCooldown;
		}

		public void setForcedRefreshCooldown(Duration forcedRefreshCooldown) {
			this.forcedRefreshCooldown = forcedRefreshCooldown;
		}

		public String getIssuer() {
			return this.issuer;
		}

		public void setIssuer(String issuer) {
			this.issuer = issuer;
		}

		public List<String> getAudiences() {
			return this.audiences;
		}

		public void setAudiences(List<String> audiences) {
			this.audiences = audiences;
		}

		public Duration getClockSkew() {
			return this.clockSkew;
		}

		public void setClockSkew(Duration clockSkew) {
			this.clockSkew = clockSkew;
		}

	}

}
