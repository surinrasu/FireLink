CREATE TRIGGER application_state_guard BEFORE UPDATE OF status ON applications
WHEN OLD.status != NEW.status AND NOT (OLD.status='pending' AND NEW.status IN ('accepted','rejected','withdrawn'))
BEGIN SELECT RAISE(ABORT, 'invalid application transition'); END;
CREATE TRIGGER application_result AFTER UPDATE OF status ON applications
WHEN OLD.status='pending' AND NEW.status IN ('accepted','rejected')
BEGIN
 INSERT INTO notifications VALUES (
 lower(hex(randomblob(16))),NEW.user_id,
 CASE NEW.status WHEN 'accepted' THEN '报名已通过' ELSE '报名未通过' END,
 COALESCE(NEW.response,'组织者已更新你的申请结果'),NEW.id,NEW.updated_at,NULL
 );
END;
