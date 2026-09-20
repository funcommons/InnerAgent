package com.inneragent.starter.testsupport;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicReference;

/** 可拨动的测试时钟(轮换宽限期淘汰等时间推进用例)。 */
public final class MutableClock extends Clock {

	private final AtomicReference<Instant> now;

	public MutableClock(Instant start) {
		this.now = new AtomicReference<>(start);
	}

	@Override
	public ZoneId getZone() {
		return ZoneId.of("UTC");
	}

	@Override
	public Clock withZone(ZoneId zone) {
		return this;
	}

	@Override
	public Instant instant() {
		return this.now.get();
	}

	public void advance(Duration amount) {
		this.now.updateAndGet(current -> current.plus(amount));
	}

}
