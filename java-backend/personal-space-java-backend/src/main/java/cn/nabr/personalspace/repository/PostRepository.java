package cn.nabr.personalspace.repository;

import cn.nabr.personalspace.model.PostView;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
public class PostRepository {
    private final JdbcTemplate jdbcTemplate;

    private final RowMapper<PostView> postMapper = (rs, rowNum) -> new PostView(
            rs.getLong("id"),
            rs.getString("content"),
            rs.getString("image"),
            rs.getString("thumbnail"),
            rs.getString("images"),
            rs.getString("thumbnails"),
            rs.getLong("user_id"),
            rs.getInt("views"),
            rs.getString("created_at"),
            rs.getString("author_name"),
            rs.getString("author_avatar"),
            rs.getInt("like_count"),
            rs.getInt("comment_count"),
            rs.getObject("liked") == null ? null : rs.getInt("liked") == 1
    );

    public PostRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<PostView> findPosts(Integer currentUserId, int page, int limit, String startDate, String endDate) {
        StringBuilder sql = new StringBuilder("""
                SELECT p.*, u.nickname AS author_name, u.avatar AS author_avatar,
                       (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                       (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
                """);
        List<Object> params = new ArrayList<>();
        if (currentUserId != null) {
            sql.append(", (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM likes WHERE post_id = p.id AND user_id = ?) AS liked ");
            params.add(currentUserId);
        } else {
            sql.append(", NULL AS liked ");
        }
        sql.append("FROM posts p LEFT JOIN users u ON p.user_id = u.id ");
        appendDateWhere(sql, params, startDate, endDate);
        sql.append(" ORDER BY p.created_at DESC LIMIT ? OFFSET ?");
        params.add(limit);
        params.add((page - 1) * limit);
        return jdbcTemplate.query(sql.toString(), postMapper, params.toArray());
    }

    public int countPosts(String startDate, String endDate) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM posts p ");
        List<Object> params = new ArrayList<>();
        appendDateWhere(sql, params, startDate, endDate);
        Integer total = jdbcTemplate.queryForObject(sql.toString(), Integer.class, params.toArray());
        return total == null ? 0 : total;
    }

    public Optional<PostView> findPostById(long id, Integer currentUserId) {
        StringBuilder sql = new StringBuilder("""
                SELECT p.*, u.nickname AS author_name, u.avatar AS author_avatar,
                       (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                       (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
                """);
        List<Object> params = new ArrayList<>();
        if (currentUserId != null) {
            sql.append(", (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM likes WHERE post_id = p.id AND user_id = ?) AS liked ");
            params.add(currentUserId);
        } else {
            sql.append(", NULL AS liked ");
        }
        sql.append("FROM posts p LEFT JOIN users u ON p.user_id = u.id WHERE p.id = ?");
        params.add(id);
        List<PostView> posts = jdbcTemplate.query(sql.toString(), postMapper, params.toArray());
        return posts.stream().findFirst();
    }

    public int incrementViews(long id) {
        jdbcTemplate.update("UPDATE posts SET views = views + 1 WHERE id = ?", id);
        Integer views = jdbcTemplate.queryForObject("SELECT views FROM posts WHERE id = ?", Integer.class, id);
        return views == null ? 0 : views;
    }

    private void appendDateWhere(StringBuilder sql, List<Object> params, String startDate, String endDate) {
        if (startDate != null && !startDate.isBlank() && endDate != null && !endDate.isBlank()) {
            sql.append("WHERE p.created_at >= ? AND p.created_at < datetime(?, '+1 day') ");
            params.add(startDate);
            params.add(endDate);
        } else if (startDate != null && !startDate.isBlank()) {
            sql.append("WHERE p.created_at >= ? ");
            params.add(startDate);
        } else if (endDate != null && !endDate.isBlank()) {
            sql.append("WHERE p.created_at < datetime(?, '+1 day') ");
            params.add(endDate);
        }
    }
}
