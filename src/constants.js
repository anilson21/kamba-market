// 21 províncias de Angola (divisão administrativa de 2024)
const PROVINCIAS = [
  'Bengo', 'Benguela', 'Bié', 'Cabinda', 'Cuando', 'Cubango', 'Cuanza Norte', 'Cuanza Sul',
  'Cunene', 'Huambo', 'Huíla', 'Icolo e Bengo', 'Luanda', 'Lunda Norte', 'Lunda Sul',
  'Malanje', 'Moxico', 'Moxico Leste', 'Namibe', 'Uíge', 'Zaire',
];

module.exports = {
  PROVINCIAS,
  ESTADOS: ['novo', 'usado'],
  LISTING_STATUS: ['pendente', 'aprovado', 'rejeitado', 'removido'],
  REPORT_MOTIVOS: [
    'Produto ilegal ou proibido',
    'Fraude ou burla',
    'Preço suspeito',
    'Fotos enganosas',
    'Conteúdo ofensivo',
    'Anúncio duplicado',
    'Outro',
  ],
};
