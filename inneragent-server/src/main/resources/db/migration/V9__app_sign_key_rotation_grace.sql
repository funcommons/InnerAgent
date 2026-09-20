-- V9 (P2-key):ia_app 签名公钥轮换双 key 列与宽限期起点。
-- 对齐 ActTokenKeyManager 的 72h 双 key 语义(02-技术方案 §6.1):
--   * PUT /ia/api/v1/admin/apps/{id} {signPublicKey} 轮换时,旧值移入
--     previous_sign_public_key,sign_key_rotated_at 记录轮换时刻(宽限期起点);
--   * 宽限期内(inneragent.auth.embed-key-grace,默认 72h)存量 embed token 仍可用
--     旧公钥验签(EmbedTokenVerifier 验签链:当前 key 失败 → previous key);
--   * 再次轮换覆盖 previous(仅保留上一代,链式历史不入库);
--   * 存量行两列保持 NULL(未轮换语义,验签链不启用宽限)。
ALTER TABLE ia_app ADD COLUMN previous_sign_public_key TEXT;
ALTER TABLE ia_app ADD COLUMN sign_key_rotated_at TIMESTAMP(3);

COMMENT ON COLUMN ia_app.previous_sign_public_key IS
    '上一代签名公钥(PEM;轮换宽限期内存量 embed token 验签用,再次轮换覆盖)';
COMMENT ON COLUMN ia_app.sign_key_rotated_at IS
    '当前签名公钥的轮换时刻(宽限期起点;NULL 表示从未轮换)';
