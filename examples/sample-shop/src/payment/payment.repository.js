export class PaymentRepository {
  constructor(db) {
    this.db = db;
  }

  async insert(payment) {
    await this.db.query(
      'INSERT INTO payments (order_id, gateway_charge_id, amount, status) VALUES ($1, $2, $3, $4)',
      [payment.orderId, payment.gatewayChargeId, payment.amount, payment.status],
    );
  }
}
