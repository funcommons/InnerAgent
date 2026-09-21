package fun.commons.acmedemo.common;

import lombok.Data;

/**
 * 统一响应封装 {code, msg, data}(与 InnerAgent CommonResult 同形)。
 *
 * 判定成功一律看 code===0,不要只看 HTTP 状态(存在 HTTP 200 + body.code=4xx 的形态)。
 */
@Data
public class R<T> {

    private int code;
    private String msg;
    private T data;

    public static <T> R<T> ok(T data) {
        R<T> r = new R<>();
        r.code = 0;
        r.msg = "success";
        r.data = data;
        return r;
    }

    public static R<Void> ok() {
        return ok(null);
    }

    public static <T> R<T> error(int code, String msg) {
        R<T> r = new R<>();
        r.code = code;
        r.msg = msg;
        return r;
    }
}
