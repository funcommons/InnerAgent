package com.inneragent.starter.bridge;

import com.inneragent.starter.IaToolDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;

/**
 * 启动期注册器(P1-T2b 职责①装配):所有宿主单例就绪后扫描 @IaTool 并注册进桥。
 * 运行期增删走 {@link IaMcpServerBridge#register}/{@link #unregister}
 * (stateless 无 tools/list_changed 推送,主服务以指纹轮询感知 —— 见桥类注释)。
 */
public class IaToolRegistrar implements SmartInitializingSingleton {

	private static final Logger log = LoggerFactory.getLogger(IaToolRegistrar.class);

	private final IaToolScanner scanner;
	private final IaMcpServerBridge bridge;

	public IaToolRegistrar(IaToolScanner scanner, IaMcpServerBridge bridge) {
		this.scanner = scanner;
		this.bridge = bridge;
	}

	@Override
	public void afterSingletonsInstantiated() {
		var definitions = this.scanner.scan();
		for (IaToolDefinition definition : definitions) {
			this.bridge.register(definition);
		}
		log.info("InnerAgent 桥已注册 {} 个宿主工具 @ {}: {}", definitions.size(),
				this.bridge.registeredTools(), definitions.stream().map(IaToolDefinition::name).sorted().toList());
	}

}
