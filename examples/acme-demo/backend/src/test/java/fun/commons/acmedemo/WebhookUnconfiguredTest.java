package fun.commons.acmedemo;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** webhookSecret 未配置 → 503(接入指南 §6.3 语义:运维问题不尝试验签,快回错误)。 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "ia.webhook-secret=",
})
class WebhookUnconfiguredTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void 未配置密钥_回调返回503() throws Exception {
        mvc.perform(post("/ia/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-IA-Signature", "a".repeat(64))
                        .header("X-IA-Timestamp", String.valueOf(System.currentTimeMillis()))
                        .header("X-IA-Nonce", "n")
                        .header("X-IA-Delivery", "d-1")
                        .content("{}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(503));
    }
}
