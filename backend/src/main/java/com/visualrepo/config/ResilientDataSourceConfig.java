package com.visualrepo.config;

import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

@Configuration
public class ResilientDataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(ResilientDataSourceConfig.class);

    @Value("${spring.datasource.url}")
    private String configuredUrl;

    @Value("${spring.datasource.username:root}")
    private String username;

    @Value("${spring.datasource.password:}")
    private String password;

    private String activeDatabaseMode = "MySQL";

    @Bean
    @Primary
    public DataSource dataSource() {
        HikariDataSource ds = new HikariDataSource();
        if (configuredUrl != null && configuredUrl.startsWith("jdbc:mysql://")) {
            if (isMySqlReachable(configuredUrl, username, password)) {
                log.info("Connecting to MySQL database at {} with user '{}'", configuredUrl, username);
                ds.setJdbcUrl(configuredUrl);
                ds.setUsername(username);
                ds.setPassword(password);
                ds.setDriverClassName("com.mysql.cj.jdbc.Driver");
                this.activeDatabaseMode = "MySQL (" + extractHostPort(configuredUrl) + ")";
                return ds;
            } else if (!"visualrepo".equals(username) && isMySqlReachable(configuredUrl, "visualrepo", "visualrepopass")) {
                log.info("Connecting to Docker MySQL database at {} with user 'visualrepo'", configuredUrl);
                ds.setJdbcUrl(configuredUrl);
                ds.setUsername("visualrepo");
                ds.setPassword("visualrepopass");
                ds.setDriverClassName("com.mysql.cj.jdbc.Driver");
                this.activeDatabaseMode = "MySQL (" + extractHostPort(configuredUrl) + ")";
                return ds;
            } else if (!"root".equals(username) && isMySqlReachable(configuredUrl, "root", "")) {
                log.info("Connecting to local MySQL database at {} with user 'root'", configuredUrl);
                ds.setJdbcUrl(configuredUrl);
                ds.setUsername("root");
                ds.setPassword("");
                ds.setDriverClassName("com.mysql.cj.jdbc.Driver");
                this.activeDatabaseMode = "MySQL (" + extractHostPort(configuredUrl) + ")";
                return ds;
            } else {
                String fallbackUrl = "jdbc:h2:file:./data/visualrepo_db;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH";
                log.warn("MySQL at {} is not reachable with user '{}'. Falling back to persistent MySQL-compatible storage at {}",
                        extractHostPort(configuredUrl), username, fallbackUrl);
                ds.setJdbcUrl(fallbackUrl);
                ds.setUsername("sa");
                ds.setPassword("");
                ds.setDriverClassName("org.h2.Driver");
                this.activeDatabaseMode = "MySQL-Compatible Local Store (Start MySQL on :3306 for native MySQL)";
                return ds;
            }
        }

        ds.setJdbcUrl(configuredUrl);
        ds.setUsername(username);
        ds.setPassword(password);
        this.activeDatabaseMode = configuredUrl.contains(":h2:") ? "H2 (MySQL Mode)" : "MySQL";
        return ds;
    }

    public String getActiveDatabaseMode() {
        return activeDatabaseMode;
    }

    private boolean isMySqlReachable(String jdbcUrl, String dbUser, String dbPassword) {
        try {
            String clean = jdbcUrl.substring("jdbc:".length());
            URI uri = URI.create(clean);
            String host = uri.getHost() != null ? uri.getHost() : "localhost";
            int port = uri.getPort() != -1 ? uri.getPort() : 3306;
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), 800);
            }
            DriverManager.setLoginTimeout(2);
            try (Connection ignored = DriverManager.getConnection(jdbcUrl, dbUser, dbPassword)) {
                return true;
            }
        } catch (SQLException e) {
            log.warn("MySQL port is open on {}, but JDBC authentication/connection failed for user '{}': {}",
                    extractHostPort(jdbcUrl), dbUser, e.getMessage());
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    private String extractHostPort(String jdbcUrl) {
        try {
            String clean = jdbcUrl.substring("jdbc:".length());
            URI uri = URI.create(clean);
            String host = uri.getHost() != null ? uri.getHost() : "localhost";
            int port = uri.getPort() != -1 ? uri.getPort() : 3306;
            return host + ":" + port;
        } catch (Exception e) {
            return "localhost:3306";
        }
    }
}
