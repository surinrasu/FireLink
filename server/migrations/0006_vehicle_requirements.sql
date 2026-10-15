UPDATE tasks
SET required_fields = '["realName","vehicles","skills"]'
WHERE id = 'task-transport'
  AND required_fields = '["realName","equipment","skills"]';
