import type { Source } from './receipts';
export const providers:{id:Source;name:string;mode:string;color:string;url:string;steps:string[];note:string}[]=[
{id:'ktx',name:'KTX · 코레일',mode:'웹 영수증',color:'#144faf',url:'https://www.korail.com/',steps:['상단 Chrome 연결에서 코레일을 연결하세요.','로그인이 필요한 경우 공식 화면에서 로그인하면 조회를 이어갑니다.','코레일톡에서 받은 이메일·PDF 영수증도 가져올 수 있어요.'],note:'현재 조회 기간의 영수증을 찾습니다. 구매 채널·추가 인증·화면 구조에 따라 공식 화면 확인이 필요할 수 있어요.'},
{id:'kakaot',name:'카카오 T',mode:'앱 거래확인증',color:'#473a15',url:'https://service.kakaomobility.com/cs/faqs/content/?category=16',steps:['카카오 T 앱에서 내 정보 → 이용기록을 여세요.','이용 건의 거래확인증 → 발급하기를 선택하세요.','저장·공유한 이미지나 PDF를 여기로 가져오세요.'],note:'개인 이용내역의 웹 자동연동은 제공하지 않습니다. 기사님께 직접 결제한 내역은 앱에서 발급되지 않을 수 있습니다.'},
{id:'tmoney',name:'티머니 · 고속버스',mode:'웹 영수증',color:'#ba3060',url:'https://www.kobus.co.kr/mrs/mrsrecplist.do',steps:['KOBUS 영수증 발행에서 예매·승차일과 결제 정보를 직접 입력하세요.','Chrome 연결은 회원 결제내역에서 시작합니다. 필요한 조회 정보를 입력하면 수집을 이어갑니다.','시외버스는 티머니 시외버스 홈페이지의 영수증 발행을 이용하세요.'],note:'고속버스는 최근 3개월 내역을 조회할 수 있습니다. 카드번호는 공식 사이트에서만 입력하세요.'},
{id:'airline',name:'항공',mode:'웹 영수증',color:'#387767',url:'https://www.koreanair.com/',steps:['구매한 항공사 또는 여행사의 예약 상세를 여세요.','e-티켓·결제 영수증을 발급해 PDF로 저장하거나 웹 페이지를 여세요.','PDF를 가져오거나 브라우저 수집 도구로 현재 페이지를 읽으세요.'],note:'Chrome 연결은 대한항공과 선택한 아시아나 화면을 탐색합니다. 다른 항공사·여행사 영수증은 파일로 가져오고, 외화는 원화 실청구 금액을 입력해 주세요.'},
{id:'socar',name:'쏘카',mode:'앱 · 기업 웹',color:'#007fc7',url:'https://enterprise.socar.kr/bizweb_guide/',steps:['쏘카 앱 이용내역 → 결제내역 → 영수증 보기를 여세요.','매출전표를 이메일로 받거나 이용내역을 저장하세요.','쏘카 기업 웹의 이용내역서 PDF도 가져올 수 있어요.'],note:'개인 영수증은 앱에서 발급합니다. 기업 웹은 별도 프로필과 본인 인증이 필요합니다.'},
];

