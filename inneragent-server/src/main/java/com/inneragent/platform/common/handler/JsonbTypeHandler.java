package com.inneragent.platform.common.handler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * MySQL JSON 类型处理器。
 * 将 Java String 以 JSON 字符串写入 MySQL JSON 列。
 *
 * <p><strong>警告(DEF-08 两次教训,V15/V22)</strong>:本 handler 为 MySQL 形,
 * <strong>禁用于本项目 PostgreSQL JSONB 列</strong>——运行态连接串无
 * {@code stringtype=unspecified},setString(varchar) 绑定 jsonb 列即全部
 * 写路径失败。当前代码库已无使用方(ia_app.circuit_limits_json V15、
 * ia_storage_config.options V22 均 TEXT 化);新 JSON 载荷列一律落 TEXT +
 * 实体纯 String,序列化收敛在服务层。保留本类仅为 MySQL 方言移植参考。
 */
@MappedTypes(String.class)
@MappedJdbcTypes(JdbcType.OTHER)
public class JsonbTypeHandler extends BaseTypeHandler<String> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, String parameter, JdbcType jdbcType) throws SQLException {
        ps.setString(i, parameter);
    }

    @Override
    public String getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return rs.getString(columnName);
    }

    @Override
    public String getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return rs.getString(columnIndex);
    }

    @Override
    public String getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return cs.getString(columnIndex);
    }
}
