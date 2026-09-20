package spike.bridge;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.TreeMap;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Checklist item 4 support: canonical-JSON sha256 fingerprint over a tool's input schema.
 *
 * The registry (ia_tool_registry) fingerprints schemas this way so that "pure-increment"
 * live-refresh diffs can be auto-accepted while security-relevant diffs (new required
 * params, readOnlyHint true->false) force re-confirmation. Canonicalization (recursive
 * key sorting) is what makes the fingerprint stable across the JSON round trip - the
 * tests assert exactly that stability across the client/server boundary.
 */
public final class SchemaFingerprints {

	private static final ObjectMapper MAPPER = new ObjectMapper();

	private SchemaFingerprints() {
	}

	public static String fingerprint(Map<String, Object> schema) {
		try {
			String canonical = MAPPER.writeValueAsString(canonicalize(schema));
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			byte[] hash = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
			StringBuilder hex = new StringBuilder();
			for (byte b : hash) {
				hex.append(String.format("%02x", b));
			}
			return hex.toString();
		}
		catch (NoSuchAlgorithmException | com.fasterxml.jackson.core.JsonProcessingException ex) {
			throw new IllegalStateException(ex);
		}
	}

	/** Recursively sorts map keys so JSON serialization is deterministic. */
	@SuppressWarnings("unchecked")
	public static Object canonicalize(Object value) {
		if (value instanceof Map<?, ?> map) {
			Map<String, Object> sorted = new TreeMap<>();
			map.forEach((k, v) -> sorted.put(String.valueOf(k), canonicalize(v)));
			return sorted;
		}
		if (value instanceof Iterable<?> iterable) {
			java.util.List<Object> list = new java.util.ArrayList<>();
			iterable.forEach(item -> list.add(canonicalize(item)));
			return list;
		}
		return value;
	}

}
