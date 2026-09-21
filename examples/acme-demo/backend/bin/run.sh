#!/bin/bash
# ACME InnerAgent 接入 DEMO 宿主后端启动脚本 (含 JVM 调优)
# 用法: IA_SERVER_BASE=... IA_SIGN_PRIVATE_KEY="$(cat host.key)" IA_WEBHOOK_SECRET=... ./bin/run.sh
#       或   JAVA_OPTS="-Xms4g -Xmx4g" ./bin/run.sh
#
# 必要环境变量见 README「运行」一节:
#   IA_SERVER_BASE      InnerAgent 主服务(默认 http://localhost:18090)
#   IA_SIGN_PRIVATE_KEY 宿主 RSA 私钥 PEM(与管理面登记公钥配对)
#   IA_WEBHOOK_SECRET   Webhook 验签密钥(可选)
#   IA_ADMIN_KEY        管理面密钥(仅一次性开通/自检,可选)
#
# JVM 调优说明:
#   -Xms=-Xmx           避免堆扩张停顿
#   G1GC + 100ms 暂停    低延迟取向
#   UseStringDeduplication  去重 (token/工单号字符串多)

JAVA_OPTS="${JAVA_OPTS:--Xms512m -Xmx1024m -XX:+UseG1GC -XX:MaxGCPauseMillis=100 -XX:+UseStringDeduplication}"

DIR="$(cd "$(dirname "$0")/.." && pwd)"
# 动态取最新构建的 fat jar(版本号随发版变化,勿硬编码)
JAR="$(ls -t "$DIR"/target/acme-demo-backend-*.jar 2>/dev/null | grep -v '\.original$' | head -1)"
[[ -n "$JAR" ]] || { echo "未找到 fat jar, 先 mvn package" >&2; exit 1; }
exec java $JAVA_OPTS -jar "$JAR" "$@"
