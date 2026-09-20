package com.inneragent.platform.service.storage;

import com.inneragent.platform.entity.storage.StorageConfig;

/**
 * Fully resolved S3-compatible storage settings.
 */
public record ResolvedS3StorageConfig(
        StorageConfig source,
        StorageProviderProfile profile,
        String provider,
        String endpoint,
        String bucketName,
        String accessKey,
        String secretKey,
        String region,
        String signingRegion,
        String basePath,
        String customDomain,
        boolean pathStyleAccessEnabled,
        boolean chunkedEncodingEnabled,
        String checksumCalculation
) {
}
