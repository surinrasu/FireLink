DROP TRIGGER application_state_guard;
CREATE TRIGGER application_state_guard BEFORE UPDATE OF status ON applications
WHEN OLD.status != NEW.status AND NOT (OLD.status='pending' AND NEW.status IN ('accepted','rejected','withdrawn','expired'))
BEGIN SELECT RAISE(ABORT, 'invalid application transition'); END;

CREATE TRIGGER application_task_ended_guard BEFORE UPDATE OF status ON applications
WHEN OLD.status='pending' AND NEW.status IN ('accepted','rejected','withdrawn')
AND EXISTS (SELECT 1 FROM tasks WHERE id=NEW.task_id AND ends_at!='' AND ends_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT, 'application_task_ended'); END;

CREATE TRIGGER application_expired_result AFTER UPDATE OF status ON applications
WHEN OLD.status='pending' AND NEW.status='expired'
BEGIN
 INSERT INTO notifications VALUES (
 lower(hex(randomblob(16))),NEW.user_id,'报名已过期',
 '任务已结束，报名未获确认，已自动过期。',NEW.id,NEW.updated_at,NULL
 );
 INSERT INTO organizer_activity
 SELECT lower(hex(randomblob(16))),organizer_id,'系统','报名已过期',title,id,NEW.updated_at
 FROM tasks WHERE id=NEW.task_id;
END;

CREATE INDEX tasks_expiry ON tasks(ends_at) WHERE ends_at!='';
