package com.inneragent.agent.state;

import io.agentscope.core.state.AgentStateStore;
import io.agentscope.core.state.State;
import io.agentscope.core.util.JsonUtils;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * PostgreSQL implementation of {@link AgentStateStore}, mirroring the storage
 * contract of AgentScope's MySQL store: rows are keyed by
 * (session_id, state_key, item_index) inside a single state table.
 */
public class PostgresAgentStateStore implements AgentStateStore {

    private static final String ANON_USER = "__anon__";
    private static final String SLOT_SEPARATOR = ":";

    private final DataSource dataSource;
    private final String tableName;
    private final io.agentscope.core.util.JsonCodec jsonCodec;

    public PostgresAgentStateStore(DataSource dataSource, String tableName) {
        this.dataSource = dataSource;
        this.tableName = tableName;
        this.jsonCodec = JsonUtils.getJsonCodec();
    }

    @Override
    public void save(String agentId, String sessionId, String stateKey, State state) {
        String slot = slotId(agentId, sessionId);
        validateSlot(slot);
        validateStateKey(stateKey);
        String json = jsonCodec.toJson(state);
        upsertItem(slot, stateKey, 0, json);
    }

    @Override
    public void save(String agentId, String sessionId, String stateKey, List<? extends State> states) {
        String slot = slotId(agentId, sessionId);
        validateSlot(slot);
        validateStateKey(stateKey);
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                deleteItems(connection, slot, stateKey, null);
                if (states != null) {
                    for (int i = 0; i < states.size(); i++) {
                        String json = jsonCodec.toJson(states.get(i));
                        insertItem(connection, slot, stateKey, i, json);
                    }
                }
                connection.commit();
            } catch (SQLException | RuntimeException exception) {
                safeRollback(connection);
                throw exception;
            } finally {
                connection.setAutoCommit(true);
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to save state list: " + exception.getMessage(), exception);
        }
    }

    @Override
    public <T extends State> Optional<T> get(
            String agentId, String sessionId, String stateKey, Class<T> type) {
        String slot = slotId(agentId, sessionId);
        validateSlot(slot);
        validateStateKey(stateKey);
        String sql = "SELECT state_data FROM " + tableName
                + " WHERE session_id = ? AND state_key = ? AND item_index = ?";
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slot);
            statement.setString(2, stateKey);
            statement.setInt(3, 0);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(jsonCodec.fromJson(resultSet.getString(1), type));
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to read state: " + exception.getMessage(), exception);
        }
    }

    @Override
    public <T extends State> List<T> getList(
            String agentId, String sessionId, String stateKey, Class<T> type) {
        String slot = slotId(agentId, sessionId);
        validateSlot(slot);
        validateStateKey(stateKey);
        String sql = "SELECT state_data FROM " + tableName
                + " WHERE session_id = ? AND state_key = ? ORDER BY item_index";
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slot);
            statement.setString(2, stateKey);
            List<T> states = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    states.add(jsonCodec.fromJson(resultSet.getString(1), type));
                }
            }
            return states;
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to read state list: " + exception.getMessage(), exception);
        }
    }

    @Override
    public boolean exists(String agentId, String sessionId) {
        String slot = slotId(agentId, sessionId);
        validateSlot(slot);
        String sql = "SELECT 1 FROM " + tableName + " WHERE session_id = ? LIMIT 1";
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slot);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next();
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to check state existence: " + exception.getMessage(), exception);
        }
    }

    @Override
    public void delete(String agentId, String sessionId) {
        String slot = slotId(agentId, sessionId);
        validateSlot(slot);
        String sql = "DELETE FROM " + tableName + " WHERE session_id = ?";
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slot);
            statement.executeUpdate();
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to delete session state: " + exception.getMessage(), exception);
        }
    }

    @Override
    public void delete(String agentId, String sessionId, String stateKey) {
        String slot = slotId(agentId, sessionId);
        validateSlot(slot);
        validateStateKey(stateKey);
        String sql = "DELETE FROM " + tableName + " WHERE session_id = ? AND state_key = ?";
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slot);
            statement.setString(2, stateKey);
            statement.executeUpdate();
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to delete state key: " + exception.getMessage(), exception);
        }
    }

    @Override
    public Set<String> listSessionIds(String agentId) {
        String prefix = normalizeUser(agentId) + SLOT_SEPARATOR;
        String sql = "SELECT DISTINCT session_id FROM " + tableName + " WHERE session_id LIKE ?";
        Set<String> sessionIds = new HashSet<>();
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, escapeLike(prefix) + "%");
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    String slot = resultSet.getString(1);
                    if (slot.length() > prefix.length()) {
                        sessionIds.add(slot.substring(prefix.length()));
                    }
                }
            }
            return sessionIds;
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to list sessions: " + exception.getMessage(), exception);
        }
    }

    @Override
    public void close() {
        // stateless over a pooled DataSource; nothing to release
    }

    private void upsertItem(String slot, String stateKey, int itemIndex, String json) {
        String sql = "INSERT INTO " + tableName
                + " (session_id, state_key, item_index, state_data) VALUES (?, ?, ?, ?) "
                + "ON CONFLICT (session_id, state_key, item_index) "
                + "DO UPDATE SET state_data = EXCLUDED.state_data, updated_at = CURRENT_TIMESTAMP";
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slot);
            statement.setString(2, stateKey);
            statement.setInt(3, itemIndex);
            statement.setString(4, json);
            statement.executeUpdate();
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to upsert state: " + exception.getMessage(), exception);
        }
    }

    private void insertItem(Connection connection, String slot, String stateKey, int itemIndex, String json)
            throws SQLException {
        String sql = "INSERT INTO " + tableName
                + " (session_id, state_key, item_index, state_data) VALUES (?, ?, ?, ?)";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, slot);
            statement.setString(2, stateKey);
            statement.setInt(3, itemIndex);
            statement.setString(4, json);
            statement.executeUpdate();
        }
    }

    private void deleteItems(Connection connection, String slot, String stateKey, Integer itemIndex)
            throws SQLException {
        if (itemIndex == null) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "DELETE FROM " + tableName + " WHERE session_id = ? AND state_key = ?")) {
                statement.setString(1, slot);
                statement.setString(2, stateKey);
                statement.executeUpdate();
            }
            return;
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "DELETE FROM " + tableName + " WHERE session_id = ? AND state_key = ? AND item_index = ?")) {
            statement.setString(1, slot);
            statement.setString(2, stateKey);
            statement.setInt(3, itemIndex);
            statement.executeUpdate();
        }
    }

    private void safeRollback(Connection connection) {
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // rollback failure must not mask the original error
        }
    }

    private static String slotId(String agentId, String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId must not be blank");
        }
        return normalizeUser(agentId) + SLOT_SEPARATOR + sessionId;
    }

    private static String normalizeUser(String agentId) {
        return agentId == null || agentId.isBlank() ? ANON_USER : agentId.trim();
    }

    private static void validateSlot(String slot) {
        if (slot.isBlank()) {
            throw new IllegalArgumentException("sessionId must not be blank");
        }
        if (slot.length() > 255) {
            throw new IllegalArgumentException("sessionId cannot exceed 255 characters");
        }
    }

    private static void validateStateKey(String stateKey) {
        if (stateKey == null || stateKey.isBlank()) {
            throw new IllegalArgumentException("State key cannot be null or empty");
        }
        if (stateKey.length() > 255) {
            throw new IllegalArgumentException("State key cannot exceed 255 characters");
        }
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
