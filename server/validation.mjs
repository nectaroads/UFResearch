export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const levels = [
  'Graduação', 'Especialização', 'Mestrado', 'Doutorado', 'Pós-doutorado',
  'Docente', 'Pesquisador(a)', 'Colaborador(a) externo(a)', 'Outro',
];

export const maxPdf = 10 * 1024 * 1024;

export function field(data, key, label, max, min = 1) {
  const value = typeof data[key] === 'string' ? data[key].trim() : '';
  if (value.length < min || value.length > max || value.includes('\0')) {
    throw new HttpError(400, `${label}: informe entre ${min} e ${max} caracteres.`);
  }
  return value;
}

function link(data, key, label, min = 0) {
  const value = field(data, key, label, 2048, min);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.href;
  } catch {
    // A URL inválida recebe a mesma mensagem que um protocolo incompatível.
  }
  throw new HttpError(400, `${label}: informe um link HTTP ou HTTPS válido.`);
}

export function password(data, required = true) {
  const value = data.password;
  if (!required && (value === '' || value === undefined)) return null;
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    throw new HttpError(400, 'A senha deve ter entre 10 e 128 caracteres.');
  }
  return value;
}

export function login(data) {
  const value = field(data, 'login', 'Login', 40, 3).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(value)) {
    throw new HttpError(400, 'Use apenas letras sem acento, números, ponto, hífen ou sublinhado no login.');
  }
  return value;
}

export function profile(data, coordinator = false) {
  const level = coordinator ? 'Coordenação' : field(data, 'level', 'Nível de estudo', 50);
  if (!coordinator && !levels.includes(level)) throw new HttpError(400, 'Selecione um nível de estudo válido.');
  return [
    field(data, 'name', 'Nome completo', 160, 2),
    login(data),
    link(data, 'lattes', 'Currículo Lattes', coordinator ? 0 : 1) ?? '',
    level,
    field(data, 'matricula', 'Matrícula', 40, 0),
  ];
}

export function publication(data) {
  const topicId = Number(data.topicId);
  const year = Number(data.year);
  if (!Number.isInteger(topicId) || topicId < 1 || topicId > 2147483647) throw new HttpError(400, 'Selecione um tema.');
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new HttpError(400, 'Informe um ano com quatro dígitos.');
  const downloadUrl = link(data, 'downloadUrl', 'Link para download');
  let pdf = null;
  if (typeof data.pdf === 'string' && data.pdf) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.pdf)) throw new HttpError(400, 'O arquivo PDF é inválido.');
    pdf = Buffer.from(data.pdf, 'base64');
    if (pdf.length > maxPdf || pdf.subarray(0, 5).toString() !== '%PDF-') {
      throw new HttpError(400, 'Selecione um PDF válido de até 10 MB.');
    }
  }
  if (pdf && downloadUrl) throw new HttpError(400, 'Informe um link ou envie um arquivo PDF.');
  return [
    topicId,
    field(data, 'title', 'Título', 300),
    field(data, 'journal', 'Revista', 240),
    field(data, 'authors', 'Autores', 300),
    year,
    downloadUrl,
    pdf,
  ];
}
