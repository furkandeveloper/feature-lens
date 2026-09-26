export class OrderRepository {
  constructor(db) {
    this.db = db;
  }

  async findById(orderId) {
    const { rows } = await this.db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    return rows[0] ?? null;
  }

  async updateStatus(orderId, status) {
    await this.db.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
  }
}
