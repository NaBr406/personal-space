package cn.nabr.personalspace;

import cn.nabr.personalspace.config.AppProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
public class PersonalSpaceJavaBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(PersonalSpaceJavaBackendApplication.class, args);
    }
}
