package cn.nabr.personalspace.repository;

import cn.nabr.personalspace.model.UserSummary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class AuthRepository {
    private final JdbcTemplate jdbcTemplate;

    private final RowMapper<UserSummary> userSummaryMapper = (rs, rowNum) -> new UserSummary(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("nickname"),
            rs.getString("avatar"),
            rs.getString("role")
    );

    public AuthRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean hasSuperAdmin() {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM users WHERE role = 'superadmin'", Integer.class);
        return count != null && count > 0;
    }

    public void createSuperAdmin(String username, String passwordHash, String nickname, String defaultAvatar) {
        jdbcTemplate.update(
                "INSERT INTO users (username, password_hash, nickname, avatar, role) VALUES (?, ?, ?, ?, 'superadmin')",
                username, passwordHash, nickname, defaultAvatar
        );
    }

    public boolean hasUnusedInviteCodeForDate(String date) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM invite_codes WHERE created_date = ? AND used_by IS NULL",
                Integer.class,
                date
        );
        return count != null && count > 0;
    }

    public void createInviteCode(String code, String date) {
        jdbcTemplate.update("INSERT INTO invite_codes (code, created_date) VALUES (?, ?)", code, date);
    }

    public Optional<DbUser> findDbUserByUsername(String username) {
        List<DbUser> users = jdbcTemplate.query(
                "SELECT id, username, password_hash, nickname, avatar, role FROM users WHERE username = ?",
                (rs, rowNum) -> new DbUser(
                        rs.getLong("id"),
                        rs.getString("username"),
                        rs.getString("password_hash"),
                        rs.getString("nickname"),
                        rs.getString("avatar"),
                        rs.getString("role")
                ),
                username
        );
        return users.stream().findFirst();
    }

    public Optional<UserSummary> findUserSummaryById(long id) {
        List<UserSummary> users = jdbcTemplate.query(
                "SELECT id, username, nickname, avatar, role FROM users WHERE id = ?",
                userSummaryMapper,
                id
        );
        return users.stream().findFirst();
    }

    public Optional<UserSummary> findUserByTokenHash(String tokenHash) {
        List<UserSummary> users = jdbcTemplate.query(
                "SELECT u.id, u.username, u.nickname, u.avatar, u.role FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.token_hash = ?",
                userSummaryMapper,
                tokenHash
        );
        return users.stream().findFirst();
    }

    public boolean usernameExists(String username) {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM users WHERE username = ?", Integer.class, username);
        return count != null && count > 0;
    }

    public boolean registerIpExists(String registerIp) {
        if (registerIp == null || registerIp.isBlank()) {
            return false;
        }
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM users WHERE register_ip = ?", Integer.class, registerIp);
        return count != null && count > 0;
    }

    public Optional<Long> findUnusedInviteCodeId(String code, String date) {
        List<Long> ids = jdbcTemplate.query(
                "SELECT id FROM invite_codes WHERE code = ? AND created_date = ? AND used_by IS NULL",
                (rs, rowNum) -> rs.getLong("id"),
                code,
                date
        );
        return ids.stream().findFirst();
    }

    public long createUser(String username, String passwordHash, String nickname, String avatar, String registerIp) {
        jdbcTemplate.update(
                "INSERT INTO users (username, password_hash, nickname, avatar, register_ip, role) VALUES (?, ?, ?, ?, ?, 'guest')",
                username, passwordHash, nickname, avatar, registerIp
        );
        Long id = jdbcTemplate.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, username);
        return id == null ? 0L : id;
    }

    public void createSession(long userId, String tokenHash) {
        jdbcTemplate.update("INSERT INTO sessions (user_id, token_hash) VALUES (?, ?)", userId, tokenHash);
    }

    public void consumeInviteCode(long userId, String code, String date) {
        jdbcTemplate.update(
                "UPDATE invite_codes SET used_by = ?, used_at = datetime('now', 'localtime') WHERE code = ? AND created_date = ? AND used_by IS NULL",
                userId, code, date
        );
    }

    public void deleteSessionByTokenHash(String tokenHash) {
        jdbcTemplate.update("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
    }

    public record DbUser(long id, String username, String passwordHash, String nickname, String avatar, String role) {}
}
