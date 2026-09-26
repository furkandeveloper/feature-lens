export class GatewayClient {
  constructor(httpClient, apiKey) {
    this.http = httpClient;
    this.apiKey = apiKey;
  }

  async charge({ amount, currency, source }) {
    const response = await this.http.post('https://gateway.example/v1/charges', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: { amount, currency, source },
    });
    return { id: response.body.id, succeeded: response.body.status === 'succeeded' };
  }
}
