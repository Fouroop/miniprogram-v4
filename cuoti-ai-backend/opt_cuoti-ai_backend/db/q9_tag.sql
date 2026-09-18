-- 九年级题库打标签：几何 / 函数
ALTER TABLE questions ADD COLUMN tag VARCHAR(32) NULL DEFAULT NULL;
UPDATE questions SET tag='几何' WHERE id BETWEEN 7 AND 16;
UPDATE questions SET tag='函数' WHERE id BETWEEN 17 AND 26;
