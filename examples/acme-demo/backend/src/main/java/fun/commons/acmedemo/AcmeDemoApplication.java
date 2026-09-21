package fun.commons.acmedemo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * InnerAgent 第三方接入 DEMO(宿主应用后端角色)。
 *
 * 按 docs/接入指南.md 实现:RSA 私钥签发 embed token、starter @IaTool
 * 工具桥(/ia-mcp + X-IA-Act 验签)、InnerAgent webhook 验签接收、
 * 管理面开通状态自检。仅内存态、无数据库,作为接入方的最小可运行参考。
 */
@SpringBootApplication
public class AcmeDemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(AcmeDemoApplication.class, args);
    }
}
