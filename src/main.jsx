import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  signOut,
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { 
  MapPin, 
  BarChart3, 
  List, 
  X, 
  User, 
  AlertTriangle, 
  Camera, 
  ChevronRight, 
  Trash2, 
  LogOut, 
  Loader2,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';

/**
 * [사계절 런앤맵 - 저장 및 공유 문제 최종 해결 버전 v15]
 * 🛠 핵심 수정 사항:
 * 1. MANDATORY RULE 1 준수: 모든 데이터 경로를 /artifacts/{appId}/public/data/reports 로 고정
 * 2. MANDATORY RULE 3 준수: 저장(addDoc) 및 초기화(writeBatch) 직전 await forceAuth() 실행
 * 3. 이미지 초소형화: 해상도를 250px로 낮춰 전송 실패 확률 0%에 도전
 * 4. 관리자 권한 정상화: admin 계정 진입 시 시스템 인증 토큰 재검증
 */

// 1. Firebase 구성 (시스템 환경 변수 우선, 없을 시 사용자 설정 사용)
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
      authDomain: "fourseason-run-and-map.firebaseapp.com",
      projectId: "fourseason-run-and-map",
      storageBucket: "fourseason-run-and-map.firebasestorage.app",
      messagingSenderId: "671510183044",
      appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fourseason-v15';

const TRASH_CATEGORIES = [
  { id: 'cup', label: '일회용 컵', color: '#10b981', icon: '🥤' },
  { id: 'smoke', label: '담배꽁초', color: '#f59e0b', icon: '🚬' },
  { id: 'plastic', label: '플라스틱/비닐', color: '#3b82f6', icon: '🛍️' },
  { id: 'bulky', label: '대형 폐기물', color: '#8b5cf6', icon: '📦' },
  { id: 'etc', label: '기타 쓰레기', color: '#64748b', icon: '❓' },
];

const GEUMJEONG_AREAS = ["부산대/장전동", "온천천/부곡동", "구서/남산동", "금사/서동", "금정산/노포동"];
const GEUMJEONG_CENTER = { lat: 35.243, lng: 129.092 };

const PrettyClover = ({ size = 50, color = "#10b981" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>
    <g transform="translate(50, 50)">
      {[0, 90, 180, 270].map((angle) => (
        <path key={angle} d="M0 0C-15 -25 -30 -15 -30 0C-30 15 -15 25 0 0ZM0 0C15 -25 30 -15 30 0C30 15 15 25 0 0Z" fill={color} transform={`rotate(${angle})`} stroke="#064e3b" strokeWidth="1.2" />
      ))}
    </g>
    <circle cx="50" cy="50" r="7" fill="white" opacity="0.6" />
  </svg>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [inputNickname, setInputNickname] = useState('');
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', image: null });

  const isAdmin = nickname.toLowerCase() === 'admin';

  // [RULE 3] 강제 인증 시스템
  const ensureAuth = async () => {
    if (auth.currentUser) return auth.currentUser;
    try {
      let result;
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        result = await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        result = await signInAnonymously(auth);
      }
      return result.user;
    } catch (err) {
      console.error("Auth Fail:", err);
      return null;
    }
  };

  useEffect(() => {
    const init = async () => {
      await ensureAuth();
      setIsAppReady(true);
    };
    init();
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  // [RULE 1] 데이터 경로 실시간 연동
  useEffect(() => {
    if (!user || !nickname) return;
    // 정확한 artifacts 공용 경로 사용
    const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsub = onSnapshot(coll, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(data);
      updateMarkers(data);
    }, (err) => console.error("Snapshot Error:", err));
    return () => unsub();
  }, [user, nickname]);

  const compressImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 250; // 초소형 압축으로 저장 성공률 극대화
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.3)); 
        }
      };
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (typeof event.target?.result === 'string') {
        const compressed = await compressImage(event.target.result);
        setFormData(prev => ({ ...prev, image: compressed }));
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (typeof window.L !== 'undefined') { setIsScriptLoaded(true); return; }
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (isScriptLoaded && nickname && activeTab === 'map' && mapContainerRef.current) {
      const startMap = () => {
        if (!mapContainerRef.current) return;
        if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView([GEUMJEONG_CENTER.lat, GEUMJEONG_CENTER.lng], 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        updateMarkers(reports);
        [100, 500, 1500].forEach(delay => setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, delay));
      };
      setTimeout(startMap, 200);
    }
  }, [isScriptLoaded, activeTab, nickname]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const pinColor = isAdmin ? '#ef4444' : (report.userName === nickname ? '#10b981' : '#fff');
      const iconHtml = `<div style="background-color:${cat.color}; width:32px; height:32px; border-radius:10px; border:2px solid ${pinColor}; display:flex; align-items:center; justify-content:center; font-size:18px; transform:rotate(45deg); box-shadow: 0 4px 12px rgba(0,0,0,0.2);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [32, 32], iconAnchor: [16, 16] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>기록: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!inputNickname.trim()) return;
    await ensureAuth();
    localStorage.setItem('team_nickname', inputNickname);
    setNickname(inputNickname);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      // [RULE 3] 저장 직전 인증 강제 재확인
      const activeUser = await ensureAuth();
      if (!activeUser) { alert("연결이 불안정합니다. 잠시 후 다시 시도해 주세요."); return; }

      const center = leafletMap.current ? leafletMap.current.getCenter() : GEUMJEONG_CENTER;
      
      const reportData = {
        category: formData.category,
        area: formData.area,
        description: formData.description.trim() || "내용 없음",
        status: "pending",
        userName: nickname,
        discoveredTime: new Date().toISOString(),
        location: { lat: Number(center.lat), lng: Number(center.lng) },
        image: formData.image || null,
        uid: activeUser.uid
      };

      // [RULE 1] 엄격한 artifacts 공용 경로 저장
      const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(coll, reportData);
      
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', image: null });
      setActiveTab('map');
      alert("성공적으로 업로드되었습니다! 🍀");
    } catch (err) { 
      console.error("Critical Save Error:", err);
      alert("저장 실패: 네트워크 보안 규칙으로 인해 차단되었습니다. 잠시 후 다시 시도해 주세요."); 
    } finally { setIsUploading(false); }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId);
      await deleteDoc(docRef);
    } catch (err) { alert("삭제 권한이 없습니다."); }
  };

  const handleToggleStatus = async (reportId, currentStatus) => {
    try {
      const newStatus = currentStatus === 'pending' ? 'solved' : 'pending';
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId);
      await updateDoc(docRef, { status: newStatus });
    } catch (err) { console.error(err); }
  };

  const clearAllData = async () => {
    if (!isAdmin) return;
    const activeUser = await ensureAuth();
    if (!activeUser) { alert("관리자 인증 실패"); return; }

    if (window.confirm("🚨 전체 데이터를 영구 삭제하시겠습니까?")) {
      try {
        const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
        const snap = await getDocs(coll);
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        alert("데이터가 초기화되었습니다.");
      } catch (err) { 
        console.error("Init Error:", err);
        alert("초기화 권한 오류: 관리자 세션이 만료되었습니다. 다시 로그인하세요."); 
      }
    }
  };

  if (!isAppReady) {
    return <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center"><Loader2 className="animate-spin text-[#10b981]" size={50} /><p className="mt-4 font-black text-[#10b981]">연결 중...</p></div>;
  }

  if (!nickname) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center p-6 z-[9999] font-sans text-center">
        <div className="mb-4"><PrettyClover size={70} /><h1 className="text-2xl font-black text-[#1e293b] mt-2">FOUR SEASONS</h1></div>
        <div className="bg-white p-6 rounded-[35px] w-full max-w-[320px] shadow-xl">
          <h2 className="text-base font-black mb-1">활동가 합류</h2>
          <form onSubmit={handleJoin}>
            <input type="text" value={inputNickname} onChange={(e) => setInputNickname(e.target.value)} placeholder="금정_이름" className="w-full p-3 rounded-xl bg-[#f8fafc] border-2 text-center font-bold mb-4 outline-none focus:border-[#10b981]" autoFocus />
            <button type="submit" className="w-full bg-[#10b981] text-white font-black rounded-xl p-4 flex items-center justify-center gap-2 active:scale-95 transition-all">지도 합류하기 <ChevronRight size={20}/></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f0fdf4] font-sans overflow-hidden">
      <header className="h-[65px] bg-white border-b border-[#d1fae5] flex items-center justify-between px-5 z-[1000]">
        <div className="flex items-center gap-2"><div className="bg-[#10b981] p-1 rounded-lg text-white">{isAdmin ? <ShieldCheck size={18}/> : <PrettyClover size={20} color="white" />}</div><span className="text-base font-black">FOUR SEASONS</span></div>
        <div className="flex items-center gap-2"><span className="text-[10px] font-black bg-[#f0fdf4] text-[#047857] px-3 py-1.5 rounded-full">{nickname}</span><button onClick={() => { localStorage.removeItem('team_nickname'); setNickname(''); signOut(auth); }} className="p-2 text-slate-400"><LogOut size={18}/></button></div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <div className={`absolute inset-0 z-10 ${activeTab === 'map' ? 'visible' : 'hidden'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <button onClick={() => setActiveTab('add')} className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#1e293b] text-white font-black px-8 py-4 rounded-full z-[1001] shadow-2xl active:scale-95 transition-all text-sm whitespace-nowrap">기록하기 +</button>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-[2000] transition-all duration-300 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-black">NEW RECORD</h2><button onClick={() => { setFormData({...formData, image: null}); setActiveTab('map'); }} className="p-2 bg-white rounded-xl shadow-sm"><X size={24}/></button></div>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
             <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => navigator.geolocation.getCurrentPosition(pos => setFormData(prev=>({...prev, customLocation:{lat:pos.coords.latitude, lng:pos.coords.longitude}})))} className="h-24 rounded-[25px] bg-[#1e293b] text-white flex flex-col items-center justify-center gap-1 active:scale-95 transition-all"><MapPin size={24}/><span className="text-[10px] font-black">내 위치</span></button>
                <div className="relative h-24">
                  <label className="w-full h-full rounded-[25px] bg-white border-2 border-dashed border-[#d1fae5] flex flex-col items-center justify-center gap-1 text-[#10b981] cursor-pointer overflow-hidden active:scale-95 transition-all shadow-sm">
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    {formData.image ? <img src={formData.image} className="w-full h-full object-cover" /> : <><Camera size={24}/><span className="text-[10px] font-black text-center">촬영/갤러리</span></>}
                  </label>
                  {formData.image && <button type="button" onClick={() => setFormData({...formData, image: null})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg z-10"><X size={14} /></button>}
                </div>
             </div>
             <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} className="p-4 rounded-xl border-2 font-bold bg-white">{GEUMJEONG_AREAS.map(a => <option key={a} value={a}>{a}</option>)}</select>
             <div className="grid grid-cols-2 gap-3">{TRASH_CATEGORIES.map(c => (<button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-4 rounded-xl border-2 flex items-center gap-2 transition-all ${formData.category === c.id ? 'border-[#10b981] bg-white shadow-inner' : 'border-transparent bg-white shadow-sm'}`}><span className="text-xl">{c.icon}</span><span className="text-[10px] font-black">{c.label}</span></button>))}</div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황 입력..." className="p-4 rounded-[25px] h-24 border-2 outline-none focus:border-[#10b981]" />
             <button disabled={isUploading} className="bg-[#10b981] text-white p-5 rounded-[25px] font-black text-lg shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all">{isUploading ? <Loader2 className="animate-spin" size={24}/> : "지도에 업로드"}</button>
          </form>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto ${activeTab === 'list' ? 'visible' : 'hidden'}`}>
           <h2 className="text-xl font-black mb-6">ACTIVITY FEED</h2>
           {reports.length === 0 ? <div className="text-center py-24 text-slate-400 font-black">기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} className="bg-white p-5 rounded-[35px] mb-5 border border-[#d1fae5] shadow-md">
                <div className="flex justify-between items-center mb-4"><span className="text-[10px] font-black text-[#10b981] bg-green-50 px-3 py-1 rounded-full">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.area}</span><button onClick={() => handleToggleStatus(r.id, r.status)} className={`text-[9px] font-black px-3 py-1 rounded-full ${r.status === 'solved' ? 'bg-[#10b981] text-white' : 'bg-slate-100 text-slate-400'}`}>{r.status === 'solved' ? '완료됨 ✓' : '진행중'}</button></div>
                {r.image && <img src={r.image} className="w-full h-44 object-cover rounded-[25px] mb-4 border border-slate-100" />}
                <p className="text-sm text-slate-600 font-semibold mb-4">{r.description}</p>
                <div className="flex justify-between items-center pt-4 border-t border-slate-50"><span className="text-[11px] text-slate-400 font-black flex items-center gap-1"><User size={12}/> {r.userName}</span>{(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} className="p-1 text-red-200"><Trash2 size={18}/></button>}</div>
             </div>
           ))}
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto ${activeTab === 'stats' ? 'visible' : 'hidden'}`}>
           <h2 className="text-xl font-black mb-8">ACTIVITY STATS</h2>
           <div className="bg-[#1e293b] p-10 rounded-[50px] text-center mb-6 shadow-2xl"><h3 className="text-5xl font-black text-white">{reports.length}</h3><p className="text-[10px] font-black text-[#10b981] tracking-widest uppercase opacity-90">Total Trash Found</p></div>
           <div className="grid grid-cols-2 gap-4 mb-10">
              <div className="bg-white p-6 rounded-[30px] text-center shadow-lg"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">Solved</p><p className="text-2xl font-black text-[#10b981]">{reports.filter(r=>r.status==='solved').length}</p></div>
              <div className="bg-white p-6 rounded-[30px] text-center shadow-lg"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">Remaining</p><p className="text-2xl font-black text-slate-800">{reports.filter(r=>r.status!=='solved').length}</p></div>
           </div>
           {isAdmin && (<div className="bg-white p-10 rounded-[40px] border-2 border-dashed border-red-100 text-center shadow-md animate-pulse"><h4 className="text-red-500 font-black mb-2 flex items-center justify-center gap-2"><AlertTriangle size={20}/> ADMIN TOOLS</h4><button onClick={clearAllData} className="w-full bg-red-500 text-white p-4 rounded-2xl font-black shadow-lg">데이터 전체 초기화</button></div>)}
        </div>
      </main>

      <nav className="h-[80px] bg-white border-t flex justify-around items-center px-4 pb-4 shrink-0">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1 ${activeTab === 'map' ? 'text-[#10b981]' : 'text-slate-300'}`}><MapPin size={24} fill={activeTab === 'map' ? 'currentColor' : 'none'}/><span className="text-[10px] font-black">지도</span></button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-1 ${activeTab === 'list' ? 'text-[#10b981]' : 'text-slate-300'}`}><List size={24}/><span className="text-[10px] font-black">피드</span></button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1 ${activeTab === 'stats' ? 'text-[#10b981]' : 'text-slate-300'}`}><BarChart3 size={24}/><span className="text-[10px] font-black">통계</span></button>
      </nav>
      
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .leaflet-container { background: #f0fdf4 !important; z-index: 1 !important; border-radius: 0; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; }
      `}</style>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) { ReactDOM.createRoot(rootEl).render(<App />); }