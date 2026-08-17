// Índice do CNAE_DATA por código, para lookup rápido
const CNAE_INDEX = {};
for (const row of CNAE_DATA) {
  CNAE_INDEX[normalizeCnae(row.cnae)] = row;
}

function normalizeCnae(code) {
  return String(code || '').replace(/[^\d]/g, '');
}

function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

function formatCnpj(digits) {
  digits = onlyDigits(digits).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function isValidCnpj(cnpj) {
  cnpj = onlyDigits(cnpj);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (base) => {
    let weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const base12 = cnpj.slice(0, 12);
  const d1 = calc(base12);
  const d2 = calc(base12 + d1);
  return cnpj.slice(12) === `${d1}${d2}`;
}

const cnpjInput = document.getElementById('cnpj');
const btn = document.getElementById('btnConsultar');
const loadingEl = document.getElementById('loading');
const errorBox = document.getElementById('errorBox');
const resultCard = document.getElementById('resultCard');

cnpjInput.addEventListener('input', (e) => {
  e.target.value = formatCnpj(e.target.value);
});
cnpjInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') consultar();
});
btn.addEventListener('click', consultar);

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
  resultCard.style.display = 'none';
}

function hideError() {
  errorBox.style.display = 'none';
}

async function consultar() {
  const cnpj = onlyDigits(cnpjInput.value);
  hideError();
  resultCard.style.display = 'none';

  if (!isValidCnpj(cnpj)) {
    showError('CNPJ inválido. Confira os números digitados.');
    return;
  }

  loadingEl.style.display = 'block';
  btn.disabled = true;

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if (!resp.ok) {
      if (resp.status === 404) throw new Error('CNPJ não encontrado na Receita Federal.');
      throw new Error('Falha ao consultar o CNPJ (tente novamente em instantes).');
    }
    const data = await resp.json();
    renderResult(data);
  } catch (err) {
    showError(err.message || 'Erro ao consultar o CNPJ.');
  } finally {
    loadingEl.style.display = 'none';
    btn.disabled = false;
  }
}

function renderResult(data) {
  const isSimples = data.opcao_pelo_simples === true;
  const cnaePrincipal = data.cnae_fiscal ? String(data.cnae_fiscal) : null;
  const cnaeDescApi = data.cnae_fiscal_descricao || '';
  const situacao = data.descricao_situacao_cadastral || '-';
  const isAtiva = situacao.toUpperCase().includes('ATIVA');

  let html = '';

  // ── Cabeçalho da ficha ──────────────────────────────────────
  html += `<div class="ficha-header">
    <div class="ficha-empresa-row">
      <h2 class="ficha-nome">${escapeHtml(data.razao_social || '-')}</h2>
      <span class="status-badge ${isAtiva ? 'badge-green' : 'badge-gray'}">● ${escapeHtml(situacao)}</span>
    </div>
    <div class="ficha-meta">
      <div class="ficha-meta-item">
        <span class="ficha-meta-label">CNPJ</span>
        <span class="ficha-meta-value">${formatCnpj(onlyDigits(data.cnpj || ''))}</span>
      </div>
      <div class="ficha-meta-item">
        <span class="ficha-meta-label">Regime tributário</span>
        <span class="ficha-meta-value ${isSimples ? 'text-green' : 'v-sec'}">
          ${isSimples ? 'Optante pelo Simples Nacional' : 'Não optante pelo Simples Nacional'}
        </span>
      </div>
    </div>
  </div>`;

  if (isSimples) {
    html += `<div class="ficha-section">
      <div class="simples-notice">
        <strong>Simples Nacional:</strong> a tributação segue o regime unificado do Simples.
        Não se aplica a tabela de retenção de IR por CNAE.
      </div>
    </div>`;
    resultCard.innerHTML = html;
    resultCard.style.display = 'block';
    return;
  }

  // ── Lista de CNAEs do CNPJ ──────────────────────────────────
  const cnaesDoCnpj = [];
  const vistos = new Set();
  if (cnaePrincipal) {
    cnaesDoCnpj.push({ codigo: normalizeCnae(cnaePrincipal), descricaoApi: cnaeDescApi });
    vistos.add(normalizeCnae(cnaePrincipal));
  }
  (data.cnaes_secundarios || []).forEach((c) => {
    const cod = normalizeCnae(c.codigo);
    if (cod && !vistos.has(cod)) {
      cnaesDoCnpj.push({ codigo: cod, descricaoApi: c.descricao || '' });
      vistos.add(cod);
    }
  });

  const match = cnaePrincipal ? CNAE_INDEX[normalizeCnae(cnaePrincipal)] : null;

  const opcoes = cnaesDoCnpj.map((c) => {
    const row = CNAE_INDEX[c.codigo];
    return {
      codigo: c.codigo,
      label: `${formatCnae(c.codigo)} — ${row ? row.descricao : c.descricaoApi}${row ? '' : ' (não consta na tabela de IR)'}`,
      naTabela: !!row,
    };
  });

  const semCnaeNaTabela = opcoes.length > 0 && opcoes.every((o) => !o.naTabela);

  // ── Seção: Atividade econômica ──────────────────────────────
  html += `<div class="ficha-section">
    <div class="ficha-section-title">Atividade econômica</div>`;

  if (opcoes.length === 0) {
    html += `<p class="info-notice">A consulta não retornou nenhum CNAE para este CNPJ.</p>`;
  } else if (semCnaeNaTabela) {
    html += `<p class="info-notice">Nenhum dos CNAEs deste CNPJ consta na tabela de referência de IR fornecida.</p>`;
  }

  if (opcoes.length > 0) {
    html += `<div class="cnae-select-box">
      <label for="cnaeSelect">CNAE da nota (dentre os CNAEs cadastrados neste CNPJ)</label>
      <select id="cnaeSelect">
        ${opcoes.map((o) => `<option value="${o.codigo}" ${!o.naTabela ? 'disabled' : ''} ${match && o.codigo === normalizeCnae(match.cnae) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    </div>`;
  }

  html += `</div>`;

  // ── Seção: Retenção de IR ───────────────────────────────────
  html += `<div class="ficha-section">
    <div class="ficha-section-title">Retenção de IR</div>
    <div id="aliquotaBox"></div>

    <div id="calcBox" style="display:none;">
      <div class="calc-section-label">Cálculo da retenção</div>
      <table class="fiscal-table">
        <tbody>
          <tr>
            <td>Valor da nota</td>
            <td class="col-value" id="calcValor">—</td>
          </tr>
          <tr>
            <td>Alíquota de IR</td>
            <td class="col-value" id="calcAliquota">—</td>
          </tr>
          <tr>
            <td><span id="calcIrLabel">IR retido</span></td>
            <td class="col-value text-red" id="calcIr">—</td>
          </tr>
          <tr class="row-total">
            <td>Valor líquido</td>
            <td class="col-value text-green" id="calcLiquido">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`;

  resultCard.innerHTML = html;
  resultCard.style.display = 'block';
  if (opcoes.length > 0) {
    const inicial = match ? normalizeCnae(match.cnae) : (opcoes.find((o) => o.naTabela) || {}).codigo || '';
    setupCnaeSelect(inicial);
  }
}

// Alíquota atualmente selecionada — fica fora do escopo da função pra o listener único
// do campo "Valor da Nota" (anexado uma vez só, ver mais abaixo) sempre pegar o valor atual.
let aliquotaAtual = 0;

function setupCnaeSelect(initialCode) {
  const select = document.getElementById('cnaeSelect');
  const aliquotaBox = document.getElementById('aliquotaBox');

  function updateAliquota() {
    const row = CNAE_INDEX[select.value];
    if (!row) {
      aliquotaBox.innerHTML = '';
      aliquotaAtual = 0;
      document.getElementById('calcIrLabel').textContent = 'IR retido';
      return;
    }
    aliquotaAtual = Number(row.aliquota_ir);
    aliquotaBox.innerHTML = `<div class="aliquota-destaque">
      <div class="aliquota-pct">${aliquotaAtual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 4 })}%</div>
      <div class="aliquota-info">Alíquota de IR aplicável<br>CNAE ${formatCnae(row.cnae)}</div>
    </div>
    <div class="cnae-detail-grid">
      <div>
        <span class="cnae-detail-label">Descrição</span>
        <span class="cnae-detail-value">${escapeHtml(row.descricao)}</span>
      </div>
      <div>
        <span class="cnae-detail-label">Natureza do bem/serviço</span>
        <span class="cnae-detail-value">${escapeHtml(row.natureza)}</span>
      </div>
    </div>`;
    document.getElementById('calcIrLabel').textContent =
      `IR retido (${aliquotaAtual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 4 })}%)`;
    recalcNota(aliquotaAtual);
  }

  select.addEventListener('change', updateAliquota);
  select.value = initialCode;
  updateAliquota();
}

// Listener único (não é recriado a cada consulta) — sempre recalcula com a alíquota atual.
document.getElementById('valorNotaInicial').addEventListener('input', () => recalcNota(aliquotaAtual));

function parseMoeda(str) {
  if (!str) return NaN;
  const cleaned = String(str).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return parseFloat(cleaned);
}

function formatMoeda(num) {
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function recalcNota(aliquotaIr) {
  const valorInput = document.getElementById('valorNotaInicial');
  const calcBox = document.getElementById('calcBox');
  const calcValor = document.getElementById('calcValor');
  const calcAliquota = document.getElementById('calcAliquota');
  const calcIr = document.getElementById('calcIr');
  const calcLiquido = document.getElementById('calcLiquido');
  if (!valorInput || !calcBox) return; // ainda não consultou nenhum CNPJ, calcBox não existe

  const valor = parseMoeda(valorInput.value);
  if (!valor || valor <= 0 || isNaN(valor) || !aliquotaIr) {
    calcBox.style.display = 'none';
    return;
  }
  const ir = valor * (Number(aliquotaIr) / 100);
  const liquido = valor - ir;
  calcValor.textContent = formatMoeda(valor);
  if (calcAliquota) calcAliquota.textContent =
    `${Number(aliquotaIr).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 4 })}%`;
  calcIr.textContent = formatMoeda(ir);
  calcLiquido.textContent = formatMoeda(liquido);
  calcBox.style.display = 'block';
}

function formatCnae(code) {
  const d = onlyDigits(code).padStart(7, '0');
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5, 7)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
