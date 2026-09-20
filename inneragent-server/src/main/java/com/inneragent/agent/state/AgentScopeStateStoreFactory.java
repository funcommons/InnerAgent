package com.inneragent.agent.state;

import io.agentscope.core.state.AgentStateStore;
import io.agentscope.core.state.InMemoryAgentStateStore;
import com.inneragent.agent.run.AgentRuntimeMetrics;

import javax.sql.DataSource;
import java.util.Objects;

public final class AgentScopeStateStoreFactory {

    private final StateStoreFailureGuard failures;
    private final AgentRuntimeMetrics metrics;

    public AgentScopeStateStoreFactory(StateStoreFailureGuard failures) {
        this(failures, AgentRuntimeMetrics.noop());
    }

    public AgentScopeStateStoreFactory(
            StateStoreFailureGuard failures, AgentRuntimeMetrics metrics) {
        this.failures = Objects.requireNonNull(failures, "failures must not be null");
        this.metrics = Objects.requireNonNull(metrics, "metrics must not be null");
    }

    public AgentStateStore createInMemory() {
        return new FailClosedAgentStateStore(
                new InMemoryAgentStateStore(), failures, metrics);
    }

    public AgentStateStore createPostgres(DataSource dataSource, String tableName) {
        PostgresAgentStateStore delegate = new PostgresAgentStateStore(
                Objects.requireNonNull(dataSource, "dataSource must not be null"),
                Objects.requireNonNull(tableName, "tableName must not be null"));
        return new FailClosedAgentStateStore(delegate, failures, metrics);
    }
}
