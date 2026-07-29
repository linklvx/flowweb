export function maskPhone(phone: string): string {
  return phone.replace(/^(\+\d{2}\d{3})\d{4}(\d{4})$/, '$1****$2');
}
