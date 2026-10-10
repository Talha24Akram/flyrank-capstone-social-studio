export function createCampaignRepo(db) {
  const ins = db.prepare(`INSERT INTO campaigns (id,name,summary,brand_voice,hero_path,subject_x,subject_y,subject_w,subject_h,idempotency_key,created_at)
    VALUES (@id,@name,@summary,@brand_voice,@hero_path,@subject_x,@subject_y,@subject_w,@subject_h,@idempotency_key,@created_at)`);
  const byId = db.prepare("SELECT * FROM campaigns WHERE id=?");
  const byKey = db.prepare("SELECT * FROM campaigns WHERE idempotency_key=?");
  const list = db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC, id LIMIT ? OFFSET ?");
  return {
    insert: (c) => ins.run({ idempotency_key: null, ...c }),
    get: (id) => byId.get(id),
    getByKey: (k) => byKey.get(k),
    list: (limit = 50, offset = 0) => list.all(limit, offset),
  };
}
