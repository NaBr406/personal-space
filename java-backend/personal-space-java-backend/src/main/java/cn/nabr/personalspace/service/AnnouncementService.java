package cn.nabr.personalspace.service;

import cn.nabr.personalspace.exception.ApiException;
import cn.nabr.personalspace.model.AnnouncementView;
import cn.nabr.personalspace.repository.AnnouncementRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class AnnouncementService {
    private final AnnouncementRepository announcementRepository;

    public AnnouncementService(AnnouncementRepository announcementRepository) {
        this.announcementRepository = announcementRepository;
    }

    public Map<String, Object> listAnnouncements(int page, int limit) {
        int safePage = Math.max(1, page);
        int safeLimit = Math.min(50, Math.max(1, limit));
        var announcements = announcementRepository.findPage(safePage, safeLimit);
        int total = announcementRepository.countAll();

        Map<String, Object> pagination = new LinkedHashMap<>();
        pagination.put("page", safePage);
        pagination.put("limit", safeLimit);
        pagination.put("total", total);
        pagination.put("pages", (int) Math.ceil(total / (double) safeLimit));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("announcements", announcements);
        body.put("pagination", pagination);
        return body;
    }

    public AnnouncementView getAnnouncement(long id) {
        return announcementRepository.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "公告不存在"));
    }
}
