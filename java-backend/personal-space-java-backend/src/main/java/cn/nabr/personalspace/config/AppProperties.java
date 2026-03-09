package cn.nabr.personalspace.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String envName = "sandbox";
    private String dataDir = "./data";
    private String defaultAvatar = "/default-avatar.png";
    private String superAdminUsername = "NaBr406";
    private String superAdminNickname = "NaBr406";
    private String superAdminPassword = "admin123";

    public String getEnvName() { return envName; }
    public void setEnvName(String envName) { this.envName = envName; }
    public String getDataDir() { return dataDir; }
    public void setDataDir(String dataDir) { this.dataDir = dataDir; }
    public String getDefaultAvatar() { return defaultAvatar; }
    public void setDefaultAvatar(String defaultAvatar) { this.defaultAvatar = defaultAvatar; }
    public String getSuperAdminUsername() { return superAdminUsername; }
    public void setSuperAdminUsername(String superAdminUsername) { this.superAdminUsername = superAdminUsername; }
    public String getSuperAdminNickname() { return superAdminNickname; }
    public void setSuperAdminNickname(String superAdminNickname) { this.superAdminNickname = superAdminNickname; }
    public String getSuperAdminPassword() { return superAdminPassword; }
    public void setSuperAdminPassword(String superAdminPassword) { this.superAdminPassword = superAdminPassword; }
}
