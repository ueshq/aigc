-- 用现有 RDS 高权限账号执行；仅调整本项目账号。
-- RDS API 的 ReadWrite 模板附带全局 PROCESS/复制权限，需要 SQL 收窄。
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'aigc_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX
ON aigc.* TO 'aigc_app'@'%';
SHOW GRANTS FOR 'aigc_app'@'%';
