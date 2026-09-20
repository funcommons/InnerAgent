package spike.bridge.server;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.stereotype.Component;

/**
 * Test observability for the spike bridge: counters the tests assert on.
 * In the real starter this role is played by audit/context-rebuild machinery, not a bean.
 */
@Component
public class BridgeObservatory {

	/** Times the X-IA-Act filter accepted a request. */
	public final AtomicInteger actValidated = new AtomicInteger();

	/** Times the X-IA-Act filter rejected a request (401). */
	public final AtomicInteger actRejected = new AtomicInteger();

	/** Monotonic ticket sequence for the write tool. */
	public final AtomicLong ticketSeq = new AtomicLong();

	/** Max observed in-flight executions of the read tool (server-side parallelism). */
	public final AtomicInteger maxConcurrentLookups = new AtomicInteger();

	private final AtomicInteger activeLookups = new AtomicInteger();

	/** Nonces of every lookup served (for response/request correlation assertions). */
	public final List<String> servedLookupNonces = new CopyOnWriteArrayList<>();

	public volatile String lastValidatedActSub = "";

	public int enterLookup() {
		int current = this.activeLookups.incrementAndGet();
		this.maxConcurrentLookups.accumulateAndGet(current, Math::max);
		return current;
	}

	public void exitLookup() {
		this.activeLookups.decrementAndGet();
	}

}
