package cn.nabr.personalspace.dto;

import jakarta.validation.constraints.NotBlank;

public class RegisterRequest {
    @NotBlank(message = "用户名和密码必填")
    private String username;
    @NotBlank(message = "用户名和密码必填")
    private String password;
    private String nickname;
    @NotBlank(message = "请填写邀请码")
    private String inviteCode;
    @NotBlank(message = "请完成验证码")
    private String captchaToken;
    @NotBlank(message = "请完成验证码")
    private String captchaAnswer;

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }
    public String getNickname() { return nickname; }
    public void setNickname(String nickname) { this.nickname = nickname; }
    public String getInviteCode() { return inviteCode; }
    public void setInviteCode(String inviteCode) { this.inviteCode = inviteCode; }
    public String getCaptchaToken() { return captchaToken; }
    public void setCaptchaToken(String captchaToken) { this.captchaToken = captchaToken; }
    public String getCaptchaAnswer() { return captchaAnswer; }
    public void setCaptchaAnswer(String captchaAnswer) { this.captchaAnswer = captchaAnswer; }
}
