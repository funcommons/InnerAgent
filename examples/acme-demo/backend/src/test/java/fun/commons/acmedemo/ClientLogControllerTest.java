package fun.commons.acmedemo;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * [E2 · P3 2026-09-27] 前端控制台错误遥测接口:免登录上报与 recent 回放,
 * 环形缓冲上限与空体容错。
 */
@SpringBootTest
@AutoConfigureMockMvc
class ClientLogControllerTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void reportsWithoutLoginAndReplaysViaRecent() throws Exception {
        mvc.perform(post("/api/demo/client-log")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"level":"console.error","message":"E2E-unique-message-A",
                                 "stack":"TypeError: x","url":"http://localhost:9203/ia/tools"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(true));

        // recent 最新在前:刚 POST 的条目必为 data[0]
        mvc.perform(get("/api/demo/client-log/recent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].level").value("console.error"))
                .andExpect(jsonPath("$.data[0].message").value("E2E-unique-message-A"))
                .andExpect(jsonPath("$.data[0].url").value("http://localhost:9203/ia/tools"));
    }

    @Test
    void emptyBodyIsToleratedWithDefaults() throws Exception {
        mvc.perform(post("/api/demo/client-log")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(true));

        mvc.perform(get("/api/demo/client-log/recent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].level").value("error"))
                .andExpect(jsonPath("$.data[0].message").value(""));
    }
}
