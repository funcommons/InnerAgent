package fun.commons.acmedemo;

import static org.mockito.Mockito.mockStatic;

import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.boot.SpringApplication;

/** 启动入口冒烟(mock SpringApplication.run,不起真实上下文)。 */
class AcmeDemoApplicationMainTest {

    @Test
    void main_启动委托给SpringApplication() {
        try (MockedStatic<SpringApplication> mocked = mockStatic(SpringApplication.class)) {
            AcmeDemoApplication.main(new String[] {});
            mocked.verify(() -> SpringApplication.run(AcmeDemoApplication.class, new String[] {}));
        }
    }
}
