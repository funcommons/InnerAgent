package com.inneragent.platform.common;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 通用分页响应结果
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PageResult<T> implements Serializable {

    private List<T> list;
    private Long total;

    /**
     * 页码(P2-admin 18a:web 契约 PageResult 形=list+total+pageNo+pageSize;
     * audit-logs 分页端点回填,既有两参构造域保持 null 兼容)
     */
    private Integer pageNo;

    /** 每页条数(同上;旧域为 null) */
    private Integer pageSize;

    /**
     * 兼容两参构造(既有调用点/测试沿用;pageNo/pageSize 不回填)。
     */
    public PageResult(List<T> list, Long total) {
        this.list = list;
        this.total = total;
    }

    /**
     * 从 MyBatis-Plus IPage 转换
     */
    public static <T> PageResult<T> of(IPage<T> page) {
        return new PageResult<>(page.getRecords(), page.getTotal());
    }

    /**
     * 从 PageParam 创建 MyBatis-Plus Page 对象（供 Service 内部使用）
     */
    public static <T> Page<T> toPage(PageParam param) {
        return new Page<>(param.getPageNo(), param.getPageSize());
    }

    /**
     * 从页码和每页条数创建 MyBatis-Plus Page 对象
     */
    public static <T> Page<T> toPage(int pageNo, int pageSize) {
        return new Page<>(pageNo, pageSize);
    }

    /**
     * 映射记录类型（Entity → VO），返回新的 PageResult
     */
    public <R> PageResult<R> map(Function<T, R> converter) {
        List<R> mapped = this.list.stream().map(converter).collect(Collectors.toList());
        return new PageResult<>(mapped, this.total);
    }
}
