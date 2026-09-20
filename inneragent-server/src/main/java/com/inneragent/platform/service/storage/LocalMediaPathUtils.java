package com.inneragent.platform.service.storage;

/**
 * /media/** 公网相对路径与本地存储路径的换算工具。
 * <p>
 * 本地媒体 URL 均携带访问签名（?e=&s=），转本地磁盘路径前必须剥离查询参数与锚点，
 * 否则会拿带参数的整串 URL 当文件路径查找。
 */
public final class LocalMediaPathUtils {

    private LocalMediaPathUtils() {
    }

    /**
     * 剥离查询参数与锚点，并去掉 "/media" 前缀，得到本地存储相对路径
     */
    public static String extractRelativePath(String url) {
        if (url == null) {
            return null;
        }
        String path = url;
        int queryIndex = path.indexOf('?');
        if (queryIndex >= 0) {
            path = path.substring(0, queryIndex);
        }
        int fragmentIndex = path.indexOf('#');
        if (fragmentIndex >= 0) {
            path = path.substring(0, fragmentIndex);
        }
        return path.replaceFirst("^/media/?", "");
    }
}
