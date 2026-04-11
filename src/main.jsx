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
 * [사계절 런앤맵 - 최종 안정화 버전 v6]
 * 1. 실행 보장: 외부 환경 변수 의존성을 제거하고 설정을 직접 주입하여 접속 불가 현상 해결
 * 2. 사진 기능: 촬영/갤러리 선택 가능 및 미리보기 삭제(X) 버튼 유지
 * 3. 저장 안정화: 데이터 정제 및 인증 강제 확인으로 저장 성공률 극대화
 * 4. UI 최적화: 메인 화면 요소 크기 조정으로 하단 버튼 표시 보장
 */

// Firebase 설정 직접 주입 (접속 오류 해결 핵심)
const firebaseConfig = {
  apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
  authDomain: "fourseason-run-and-map.firebaseapp.com",
  projectId: "fourseason-run-and-map",
  storageBucket: "fourseason-run-and-map.firebasestorage.app",
  messagingSenderId: "671510183044",
  appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
  databaseURL: "https://fourseason-run-and-map-default-rtdb.firebaseio.com/" 
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'fourseason-run-and-map-v2024-final-v6';

const TRASH_CATEGORIES = [
  { id: 'cup', label: '일회용 컵', color: '#10b981', icon: '🥤' },
  { id: 'smoke', label: '담배꽁초', color: '#f59e0b', icon: '🚬' },
  { id: 'plastic', label: '플라스틱/비닐', color: '#3b82f6', icon: '🛍️' },
  { id: 'bulky', label: '대형 폐기물', color: '#8b5cf6', icon: '📦' },
  { id: 'etc', label: '기타 쓰레기', color: '#64748b', icon: '❓' },
];

const GEUMJEONG_AREAS = ["부산대/장전동", "온천천/부곡동", "구서/남산동", "금사/서동", "금정산/노포동"];
const GEUMJEONG_CENTER = [35.243, 129.092];

const PrettyClover = ({ size = 50, color = "#10b981" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>
    <g transform="translate(50, 50)">
      {[0, 90, 180, 270].map((angle) => (
        <path 
          key={angle}
          d="M0 0C-15 -25 -30 -15 -30 0C-30 15 -15 25 0 0ZM0 0C15 -25 30 -15 30 0C30 15 15 25 0 0Z" 
          fill={color} 
          transform={`rotate(${angle})`}
          stroke="#064e3b"
          strokeWidth="1.2"
        />
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
  const [isLocating, setIsLocating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null
  });

  const isAdmin = nickname.toLowerCase() === 'admin';

  const compressImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400; 
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.4)); 
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

  const ensureAuth = async () => {
    if (auth.currentUser) return auth.currentUser;
    try {
      const res = await signInAnonymously(auth);
      setUser(res.user);
      return res.user;
    } catch (err) {
      console.error("Auth Fail", err);
      return null;
    }
  };

  useEffect(() => {
    const bootApp = async () => {
      await ensureAuth();
      setIsAppReady(true);
    };
    bootApp();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !nickname) return;
    const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(coll, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(data);
      updateMarkers(data);
    });
    return () => unsubscribe();
  }, [user, nickname]);

  useEffect(() => {
    if (typeof window.L !== 'undefined') {
      setIsScriptLoaded(true);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (isScriptLoaded && nickname && activeTab === 'map' && mapContainerRef.current) {
      const initMap = () => {
        if (!mapContainerRef.current) return;
        if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        updateMarkers(reports);
        [100, 400, 1000].forEach(delay => {
          setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, delay);
        });
      };
      const timer = setTimeout(initMap, 200);
      return () => {
        clearTimeout(timer);
        if (leafletMap.current) {
          leafletMap.current.remove();
          leafletMap.current = null;
        }
      };
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
    try {
      await ensureAuth();
      localStorage.setItem('team_nickname', inputNickname);
      setNickname(inputNickname);
    } catch (err) {
      alert("합류 실패! 네트워크 상태를 확인하세요.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      const activeUser = await ensureAuth(); 
      if (!activeUser) throw new Error("AUTH_FAIL");

      const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      const loc = formData.customLocation 
        ? { lat: Number(formData.customLocation.lat), lng: Number(formData.customLocation.lng) }
        : { lat: Number(center.lat), lng: Number(center.lng) };
      
      const reportData = {
        category: formData.category,
        area: formData.area,
        description: formData.description || "",
        status: "pending",
        userName: nickname,
        discoveredTime: new Date().toISOString(),
        location: loc,
        image: formData.image || null
      };

      const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(coll, reportData);
      
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("지도에 성공적으로 저장되었습니다! 🍀");
    } catch (err) { 
      console.error("Save Error:", err);
      alert("저장에 실패했습니다. 사진 용량을 줄이거나 잠시 후 다시 시도하세요."); 
    } finally { setIsUploading(false); }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm("기록을 삭제하시겠습니까?")) return;
    try {
      await ensureAuth();
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId));
    } catch (err) { alert("삭제 권한이 없습니다."); }
  };

  const handleToggleStatus = async (reportId, currentStatus) => {
    try {
      await ensureAuth();
      const newStatus = currentStatus === 'pending' ? 'solved' : 'pending';
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId), { status: newStatus });
    } catch (err) { console.error(err); }
  };

  if (!isAppReady) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-[#10b981]" size={50} />
        <p className="mt-4 font-black text-[#10b981] text-lg">사계절 앱 연결 중...</p>
      </div>
    );
  }

  if (!nickname) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center p-6 z-[9999] font-sans text-center overflow-hidden">
        <div className="mb-4 w-full">
          <div className="mx-auto mb-3 flex justify-center">
            <PrettyClover size={80} />
          </div>
          <h1 className="text-2xl font-black text-[#1e293b] mb-0 tracking-tight">FOUR SEASONS</h1>
          <p className="text-[9px] font-black text-[#10b981] tracking-widest uppercase opacity-80">Run & Map Geumjeong</p>
        </div>
        <div className="bg-white p-6 rounded-[35px] w-full max-w-[320px] shadow-xl border border-green-50">
          <h2 className="text-base font-black text-[#1e293b] mb-1">활동가 합류</h2>
          <p className="text-[11px] text-[#64748b] mb-6 leading-relaxed">우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={handleJoin}>
            <input 
              type="text" 
              value={inputNickname}
              onChange={(e) => setInputNickname(e.target.value)}
              placeholder="예시: 금정_이름" 
              className="w-full p-3 rounded-xl bg-[#f8fafc] border-2 border-[#e2e8f0] text-center font-bold text-lg mb-4 outline-none focus:border-[#10b981] transition-all" 
              autoFocus 
            />
            <button type="submit" className="w-full bg-[#10b981] text-white font-black rounded-xl p-4 text-base shadow-lg flex items-center justify-center gap-2 hover:bg-[#059669] active:scale-95 transition-all">지도 합류하기 <ChevronRight size={20}/></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f0fdf4] font-sans overflow-hidden">
      <header className="h-[65px] bg-white border-b border-[#d1fae5] flex items-center justify-between px-5 shrink-0 z-[1000]">
        <div className="flex items-center gap-2">
          <div className="bg-[#10b981] p-1.5 rounded-lg text-white shadow-sm">
            {isAdmin ? <ShieldCheck size={18}/> : <PrettyClover size={22} color="white" />}
          </div>
          <span className="text-base font-black text-[#1e293b] tracking-tight">FOUR SEASONS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black bg-[#f0fdf4] text-[#047857] px-3 py-1.5 rounded-full border border-[#d1fae5]">{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃 하시겠습니까?")){ localStorage.removeItem('team_nickname'); setNickname(''); signOut(auth); } }} className="p-2 bg-slate-50 rounded-xl text-slate-400 active:scale-90 transition-all"><LogOut size={18}/></button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <div className={`absolute inset-0 z-10 ${activeTab === 'map' ? 'visible' : 'hidden'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <button 
            onClick={() => setActiveTab('add')} 
            className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#1e293b] text-white font-black px-8 py-4 rounded-full z-[1001] shadow-2xl active:scale-95 transition-transform text-sm flex items-center gap-2 whitespace-nowrap"
            style={{ minWidth: '140px', justifyContent: 'center' }}
          >
            기록하기 <PrettyClover size={16} color="white" />
          </button>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-[2000] transition-transform duration-300 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-black text-[#1e293b]">NEW RECORD</h2>
            <button onClick={() => { setFormData({...formData, image: null}); setActiveTab('map'); }} className="p-2 bg-white rounded-xl shadow-sm border border-green-50"><X size={24}/></button>
          </div>
          <form onSubmit={handleSave} className="flex flex-col gap-4 pb-12">
             <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => { navigator.geolocation.getCurrentPosition(pos => setFormData(prev=>({...prev, customLocation:{lat:pos.coords.latitude, lng:pos.coords.longitude}}))) }} className="h-24 rounded-[25px] bg-[#1e293b] text-white flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-lg">
                   <MapPin size={24} color={formData.customLocation ? "#10b981" : "white"}/>
                   <span className="text-[10px] font-black">{formData.customLocation ? "위치 완료" : "내 위치 찾기"}</span>
                </button>
                <div className="relative h-24">
                  <label className="w-full h-full rounded-[25px] bg-white border-2 border-dashed border-[#d1fae5] flex flex-col items-center justify-center gap-2 text-[#10b981] cursor-pointer overflow-hidden active:scale-95 transition-all shadow-sm">
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    {formData.image ? (
                      <img src={formData.image} className="w-full h-full object-cover" />
                    ) : (
                      <><Camera size={24}/><span className="text-[10px] font-black text-center">촬영 또는<br/>갤러리 선택</span></>
                    )}
                  </label>
                  {formData.image && (
                    <button 
                      type="button" 
                      onClick={(e) => { e.preventDefault(); setFormData({...formData, image: null}); }}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg z-10"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
             </div>
             <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} className="p-4 rounded-xl border-2 border-[#e2e8f0] font-bold text-base outline-none focus:border-[#10b981] bg-white shadow-sm">
                {GEUMJEONG_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
             </select>
             <div className="grid grid-cols-2 gap-3">
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-4 rounded-xl border-2 flex items-center gap-2 transition-all ${formData.category === c.id ? 'border-[#10b981] bg-white shadow-inner scale-95' : 'border-transparent bg-white shadow-sm'}`}>
                   <span className="text-xl">{c.icon}</span><span className="text-[10px] font-black">{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 간단히 입력해 주세요." className="p-5 rounded-[25px] h-28 border-2 border-[#e2e8f0] outline-none resize-none focus:border-[#10b981] text-base shadow-sm" />
             <button disabled={isUploading} className="bg-[#10b981] text-white p-5 rounded-[25px] font-black text-lg shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform">
               {isUploading ? <Loader2 className="animate-spin" size={24}/> : "지도에 업로드"}
             </button>
          </form>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto ${activeTab === 'list' ? 'visible' : 'hidden'}`}>
           <h2 className="text-xl font-black text-[#1e293b] mb-6">ACTIVITY FEED</h2>
           {reports.length === 0 ? <div className="text-center py-24 text-slate-400 font-black text-lg">아직 기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} className="bg-white p-5 rounded-[35px] mb-5 border border-[#d1fae5] shadow-md text-center text-slate-800">
                <div className="flex justify-between items-center mb-4">
                   <span className="text-[10px] font-black text-[#10b981] bg-green-50 px-3 py-1 rounded-full border border-green-100 flex items-center gap-2">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.area}</span>
                   <button onClick={() => handleToggleStatus(r.id, r.status)} className={`text-[9px] font-black px-3 py-1 rounded-full shadow-sm transition-all active:scale-90 ${r.status === 'solved' ? 'bg-[#10b981] text-white' : 'bg-slate-100 text-slate-400'}`}>{r.status === 'solved' ? '해결 완료 ✓' : '진행중'}</button>
                </div>
                {r.image && <img src={r.image} className="w-full h-44 object-cover rounded-[25px] mb-4 mx-auto border border-slate-100" />}
                <p className="text-base text-slate-600 leading-relaxed font-semibold px-2 mb-4">{r.description || "내용 없음"}</p>
                <div className="flex justify-between items-center pt-4 border-t border-slate-50">
                  <span className="text-[11px] text-slate-400 font-black flex items-center gap-1.5"><User size={12}/> {r.userName}</span>
                  {(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} className="p-1.5 text-red-200 hover:text-red-400 active:scale-90 transition-all"><Trash2 size={20}/></button>}
                </div>
             </div>
           ))}
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto ${activeTab === 'stats' ? 'visible' : 'hidden'}`}>
           <h2 className="text-xl font-black text-[#1e293b] mb-8">ACTIVITY STATS</h2>
           <div className="bg-[#1e293b] p-10 rounded-[50px] text-center mb-6 shadow-2xl">
              <h3 className="text-5xl font-black text-white mb-1">{reports.length}</h3>
              <p className="text-[10px] font-black text-[#10b981] tracking-widest uppercase opacity-90">Total Trash Found</p>
           </div>
           <div className="grid grid-cols-2 gap-4 mb-10">
              <div className="bg-white p-8 rounded-[40px] text-center border border-green-50 shadow-lg"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-tighter">Solved</p><p className="text-3xl font-black text-[#10b981]">{reports.filter(r=>r.status==='solved').length}</p></div>
              <div className="bg-white p-8 rounded-[40px] text-center border border-green-50 shadow-lg"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-tighter">Pending</p><p className="text-3xl font-black text-slate-800">{reports.filter(r=>r.status!=='solved').length}</p></div>
           </div>
        </div>
      </main>

      <nav className="h-[90px] bg-white border-t border-[#d1fae5] flex justify-around items-center px-4 pb-8 shrink-0">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'map' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/>
          <span className="text-[10px] font-black">지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'list' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <List size={26} strokeWidth={3}/>
          <span className="text-[10px] font-black">피드</span>
        </button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'stats' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <BarChart3 size={26} strokeWidth={3}/>
          <span className="text-[10px] font-black">통계</span>
        </button>
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
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}