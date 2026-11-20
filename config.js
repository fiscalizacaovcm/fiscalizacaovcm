/* Configuração do app · Fiscalização de Obras
 * Para cada divisão, cole em "url" o endereço do App da Web do Apps Script da planilha
 * (Implantar > Gerenciar implantações > copiar o endereço que termina em /exec).
 * A chave (CEP, SUL, MSL, CMN) é o começo dos códigos de acesso da divisão.
 * Os códigos de acesso NUNCA vão neste arquivo: eles ficam só na aba "chaves" de cada planilha. */
window.FISC_CONFIG = {
  divisoes: {
    CEP: { sigla: 'VCMCEP', url: '' },
    SUL: { sigla: 'VCMSUL', url: '' },
    MSL: { sigla: 'VCMMSL', url: '' },
    CMN: { sigla: 'VCMCMN', url: '' }
  }
};
