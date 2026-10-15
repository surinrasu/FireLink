CREATE TRIGGER task_insert_updates_incident AFTER INSERT ON tasks
BEGIN UPDATE incidents SET updated_at=MAX(updated_at,NEW.updated_at) WHERE id=NEW.incident_id; END;
CREATE TRIGGER task_change_updates_incident AFTER UPDATE OF updated_at ON tasks
BEGIN UPDATE incidents SET updated_at=MAX(updated_at,NEW.updated_at) WHERE id=NEW.incident_id; END;
