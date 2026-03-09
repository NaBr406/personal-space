package cn.nabr.personalspace.config;

import cn.nabr.personalspace.repository.AuthRepository;
import cn.nabr.personalspace.util.InviteCodeGenerator;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;

@Component
public class StartupInitializer {
    private final AppProperties appProperties;
    private final AuthRepository authRepository;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public StartupInitializer(AppProperties appProperties, AuthRepository authRepository) {
        this.appProperties = appProperties;
        this.authRepository = authRepository;
    }

    @PostConstruct
    public void init() throws Exception {
        Files.createDirectories(Path.of(appProperties.getDataDir()));

        if (!authRepository.hasSuperAdmin()) {
            authRepository.createSuperAdmin(
                    appProperties.getSuperAdminUsername(),
                    passwordEncoder.encode(appProperties.getSuperAdminPassword()),
                    appProperties.getSuperAdminNickname(),
                    appProperties.getDefaultAvatar()
            );
        }

        String today = LocalDate.now().toString();
        if (!authRepository.hasUnusedInviteCodeForDate(today)) {
            authRepository.createInviteCode(InviteCodeGenerator.generate(), today);
        }
    }
}
