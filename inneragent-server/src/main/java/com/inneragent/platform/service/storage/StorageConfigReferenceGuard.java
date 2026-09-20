package com.inneragent.platform.service.storage;

@FunctionalInterface
public interface StorageConfigReferenceGuard {

    void assertDeletable(Long storageConfigId);
}
