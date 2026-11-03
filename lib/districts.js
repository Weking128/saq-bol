// Город Тараз и районы Жамбылской области. id используется в базе — не меняйте его.
export const DISTRICTS = [
  { id: 'taraz', ru: 'г. Тараз', kk: 'Тараз қаласы', centerRu: 'областной центр', centerKk: 'облыс орталығы' },
  { id: 'baizak', ru: 'Байзакский район', kk: 'Байзақ ауданы', centerRu: 'с. Сарыкемер', centerKk: 'Сарыкемер ауылы' },
  { id: 'zhambyl', ru: 'Жамбылский район', kk: 'Жамбыл ауданы', centerRu: 'с. Аса', centerKk: 'Аса ауылы' },
  { id: 'zhualy', ru: 'Жуалынский район', kk: 'Жуалы ауданы', centerRu: 'с. Б. Момышулы', centerKk: 'Б. Момышұлы ауылы' },
  { id: 'kordai', ru: 'Кордайский район', kk: 'Қордай ауданы', centerRu: 'с. Кордай', centerKk: 'Қордай ауылы' },
  { id: 'merke', ru: 'Меркенский район', kk: 'Меркі ауданы', centerRu: 'с. Мерке', centerKk: 'Меркі ауылы' },
  { id: 'moiynkum', ru: 'Мойынкумский район', kk: 'Мойынқұм ауданы', centerRu: 'с. Мойынкум', centerKk: 'Мойынқұм ауылы' },
  { id: 'sarysu', ru: 'Сарысуский район', kk: 'Сарысу ауданы', centerRu: 'г. Жанатас', centerKk: 'Жаңатас қаласы' },
  { id: 'talas', ru: 'Таласский район', kk: 'Талас ауданы', centerRu: 'г. Каратау', centerKk: 'Қаратау қаласы' },
  { id: 'ryskulov', ru: 'Район Т. Рыскулова', kk: 'Т. Рысқұлов ауданы', centerRu: 'с. Кулан', centerKk: 'Құлан ауылы' },
  { id: 'shu', ru: 'Шуский район', kk: 'Шу ауданы', centerRu: 'с. Толе би, г. Шу', centerKk: 'Төле би ауылы, Шу қаласы' },
];

export const DISTRICT_IDS = DISTRICTS.map((d) => d.id);
export const DISTRICTS_BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]));
