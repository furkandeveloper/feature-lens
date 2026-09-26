export class PaymentService {
  constructor({ orders, payments, gateway }) {
    this.orders = orders;
    this.payments = payments;
    this.gateway = gateway;
  }

  async payOrder(orderId, cardToken) {
    const order = await this.orders.findById(orderId);
    if (!order) return { ok: false, error: 'ORDER_NOT_FOUND' };
    if (order.status !== 'pending') return { ok: false, error: 'ORDER_NOT_PAYABLE' };

    const charge = await this.gateway.charge({
      amount: order.total,
      currency: order.currency,
      source: cardToken,
    });

    await this.payments.insert({
      orderId,
      gatewayChargeId: charge.id,
      amount: order.total,
      status: charge.succeeded ? 'captured' : 'failed',
    });

    if (!charge.succeeded) return { ok: false, error: 'CARD_DECLINED' };

    await this.orders.updateStatus(orderId, 'paid');
    return { ok: true, chargeId: charge.id };
  }
}
