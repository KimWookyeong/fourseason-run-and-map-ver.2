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
 * [사계절 런앤맵 - 최종 안정화 v25]
 * 🛠 핵심 수정 사항:
 * 1. 디자인 개선: 더 예쁜 하트잎 네잎클로버 SVG 적용 및 중앙 배치
 * 2. 문구 수정: 활동 의미를 살린 세련된 문구로 교체
 * 3. 저장 실패 완전 해결: MANDATORY RULE 1에 따라 모든 경로를 /artifacts/... 로 강제 고정
 * 4. 지도 즉시 표시: 탭 이동 없이 입장 직후 지도가 뜨도록 Resize 및 Invalidate 엔진 탑재
 * 5. 관리자 권한 복구: 데이터 초기화 전용 경로 동기화로 오류 해결
 */

// 1. Firebase 구성 (시스템 환경 변수 우선 감지)
const getFirebaseConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
      return JSON.parse(__firebase_config);
    }
  } catch (e) { console.error("Config parse error", e); }
  return {
    apiKey: "AIzaSyBYfwtdXjz4ekJbH83merNVPZemb_bc3NE",
    authDomain: "fourseason-run-and-map.firebaseapp.com",
    projectId: "fourseason-run-and-map",
    storageBucket: "fourseason-run-and-map.firebasestorage.app",
    messagingSenderId: "671510183044",
    appId: "1:671510183044:web:59ad0cc29cf6bd98f3d6d1",
  };
};

const firebaseConfig = getFirebaseConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// [MANDATORY RULE 1] 보안 경로 설정을 위한 시스템 전용 appId 확보 (수정 금지)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fourseason-v25-final';

const TRASH_CATEGORIES = [
  { id: 'cup', label: '일회용 컵', color: '#10b981', icon: '🥤' },
  { id: 'smoke', label: '담배꽁초', color: '#f59e0b', icon: '🚬' },
  { id: 'plastic', label: '플라스틱/비닐', color: '#3b82f6', icon: '🛍️' },
  { id: 'bulky', label: '대형 폐기물', color: '#8b5cf6', icon: '📦' },
  { id: 'etc', label: '기타 쓰레기', color: '#64748b', icon: '❓' },
];

const GEUMJEONG_AREAS = ["부산대/장전동", "온천천/부곡동", "구서/남산동", "금사/서동", "금정산/노포동"];
const GEUMJEONG_CENTER = { lat: 35.243, lng: 129.092 };

// 더 예쁘고 정교한 하트잎 네잎클로버 SVG
const PrettyClover = ({ size = 80 }) => (
  <div className="flex justify-center items-center">
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-lg">
      <g transform="translate(50, 50)">
        {[0, 90, 180, 270].map((angle) => (
          <path 
            key={angle}
            d="M0 0C-18 -28 -35 -15 -35 0C-35 15 -18 28 0 0ZM0 0C18 -28 35 -15 35 0C35 15 18 28 0 0Z" 
            fill="#10b981" 
            transform={`rotate(${angle})`}
            stroke="#064e3b"
            strokeWidth="1.5"
          />
        ))}
      </g>
      <circle cx="50" cy="50" r="8" fill="white" opacity="0.7" />
    </svg>
  </div>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [inputNickname, setInputNickname] = useState('');
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  const [msg, setMsg] = useState(null);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', image: null });

  const isAdmin = nickname.toLowerCase() === 'admin';

  const showToast = (text, type = 'info') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  // [RULE 3] 초기 인증 엔진 - 앱 진입 전 인증 완결 보장
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (!auth.currentUser) {
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            await signInAnonymously(auth);
          }
        }
      } catch (err) {
        console.error("인증 실패:", err);
      } finally {
        setIsAppReady(true);
      }
    };
    initAuth();
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  // [RULE 1] 데이터 실시간 스트리밍 (지정된 보안 경로 강제 적용)
  useEffect(() => {
    if (!user || !nickname) return;
    const collPath = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsub = onSnapshot(collPath, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(data);
      updateMarkers(data);
    }, (err) => {
      console.error("수신 거부됨:", err);
      if (err.code === 'permission-denied') {
        showToast("보안 정책에 의해 접근이 차단되었습니다. 다시 입장하세요.", "error");
      }
    });
    return () => unsub();
  }, [user, nickname]);

  const compressImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 250; 
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

  // 지도 라이브러리 로드
  useEffect(() => {
    if (typeof window.L !== 'undefined') { setIsScriptLoaded(true); return; }
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // 지도 즉시 렌더링 엔진 (입장 직후 맵 활성화 핵심 로직)
  useEffect(() => {
    if (isScriptLoaded && nickname && activeTab === 'map' && mapContainerRef.current) {
      const startMap = () => {
        if (!mapContainerRef.current) return;
        if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
        
        leafletMap.current = window.L.map(mapContainerRef.current, { 
          zoomControl: false, attributionControl: false 
        }).setView([GEUMJEONG_CENTER.lat, GEUMJEONG_CENTER.lng], 14);
        
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
        updateMarkers(reports);

        // [핵심 보정] 레이아웃 변경 감지 즉시 지도 보정
        const resizeObserver = new ResizeObserver(() => {
          if (leafletMap.current) {
            leafletMap.current.invalidateSize();
          }
        });
        resizeObserver.observe(mapContainerRef.current);
        
        // 추가로 입장 직후 0.1초 간격으로 크기 강제 재계산
        let count = 0;
        const fix = setInterval(() => {
          if (leafletMap.current) leafletMap.current.invalidateSize();
          if (++count > 10) clearInterval(fix);
        }, 150);

        return () => resizeObserver.disconnect();
      };
      
      const timer = setTimeout(startMap, 100);
      return () => clearTimeout(timer);
    }
  }, [isScriptLoaded, nickname, activeTab]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const pinColor = isAdmin ? '#ef4444' : (report.userName === nickname ? '#10b981' : '#fff');
      const iconHtml = `<div style="background-color:${cat.color}; width:30px; height:30px; border-radius:10px; border:2px solid ${pinColor}; display:flex; align-items:center; justify-content:center; font-size:16px; transform:rotate(45deg); box-shadow: 0 4px 10px rgba(0,0,0,0.2);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>활동가: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!inputNickname.trim()) return;
    localStorage.setItem('team_nickname', inputNickname);
    setNickname(inputNickname);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    // [RULE 3] 저장 직전 사용자 인증 유효성 확인
    if (!auth.currentUser) {
      showToast("보안 세션 연결 중입니다. 한 번 더 눌러주세요.", "error");
      return;
    }
    
    setIsUploading(true);
    try {
      const center = leafletMap.current ? leafletMap.current.getCenter() : GEUMJEONG_CENTER;
      
      const reportData = {
        category: formData.category,
        area: formData.area,
        description: (formData.description || "").trim() || "내용 없음",
        status: "pending",
        userName: nickname,
        discoveredTime: new Date().toISOString(),
        location: { 
          lat: Number(center.lat) || GEUMJEONG_CENTER.lat, 
          lng: Number(center.lng) || GEUMJEONG_CENTER.lng 
        },
        image: formData.image || null,
        uid: auth.currentUser.uid
      };
      
      // [RULE 1] 시스템 승인 경로 /artifacts/... 엄격 적용
      const collPath = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(collPath, reportData);
      
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', image: null });
      setActiveTab('map');
      showToast("기록이 성공적으로 공유되었습니다! 🍀", "success");
    } catch (err) { 
      console.error("저장 실패 원인:", err);
      showToast("저장 실패: 보안 규칙 거부. 관리자에게 문의하세요.", "error"); 
    } finally { setIsUploading(false); }
  };

  const handleDelete = async (reportId) => {
    if (!user || !window.confirm("기록을 삭제하시겠습니까?")) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId);
      await deleteDoc(docRef);
      showToast("활동 기록이 삭제되었습니다.");
    } catch (err) { showToast("삭제 권한이 부족합니다.", "error"); }
  };

  const handleToggleStatus = async (reportId, currentStatus) => {
    if (!user) return;
    try {
      const newStatus = currentStatus === 'pending' ? 'solved' : 'pending';
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId);
      await updateDoc(docRef, { status: newStatus });
    } catch (err) { console.error(err); }
  };

  const clearAllData = async () => {
    if (!isAdmin || !auth.currentUser) {
      showToast("관리자 권한이 부족합니다.", "error");
      return;
    }
    
    if (window.confirm("🚨 전체 데이터를 영구적으로 삭제하시겠습니까?")) {
      try {
        const collPath = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
        const snap = await getDocs(collPath);
        if (snap.empty) { showToast("삭제할 데이터가 없습니다."); return; }
        
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        showToast("모든 데이터가 깨끗하게 초기화되었습니다.", "success");
      } catch (err) { 
        console.error("초기화 실패 원인:", err);
        showToast("초기화 오류: 세션이 만료되었습니다. 다시 로그인하세요.", "error"); 
      }
    }
  };

  if (!isAppReady) {
    return <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center"><Loader2 className="animate-spin text-[#10b981]" size={50} /><p className="mt-4 font-black text-[#10b981]">보안 서버 연결 중...</p></div>;
  }

  if (!nickname) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center p-6 z-[9999] font-sans text-center">
        <div className="mb-8 flex flex-col items-center">
          <PrettyClover size={100} />
          <h1 className="text-3xl font-black text-[#1e293b] mt-4 tracking-tighter">FOUR SEASONS</h1>
          <p className="text-[12px] text-[#059669] font-bold mt-2 bg-white px-4 py-1 rounded-full shadow-sm">금정구의 사계절을 기록하고 함께 지켜나가요</p>
        </div>
        <div className="bg-white p-8 rounded-[45px] w-full max-w-[340px] shadow-2xl border border-[#d1fae5]">
          <h2 className="text-xl font-black mb-1 text-[#1e293b]">활동가 합류</h2>
          <p className="text-[10px] text-slate-400 mb-6 font-medium">실시간 환경 지도 활동을 위해 닉네임을 입력해 주세요.</p>
          <form onSubmit={handleJoin}>
            <input 
              type="text" 
              value={inputNickname} 
              onChange={(e) => setInputNickname(e.target.value)} 
              placeholder="닉네임 (예: 금정_철수)" 
              className="w-full p-4 rounded-2xl bg-[#f8fafc] border-2 border-slate-100 text-center font-bold text-lg mb-4 outline-none focus:border-[#10b981] transition-all" 
              autoFocus 
            />
            <button type="submit" className="w-full bg-[#10b981] text-white font-black rounded-2xl p-4 flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg hover:bg-[#059669]">지도 합류하기 <ChevronRight size={20}/></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f0fdf4] font-sans overflow-hidden">
      {msg && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[5000] px-6 py-3 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-bounce ${msg.type === 'error' ? 'bg-red-500 text-white' : 'bg-[#1e293b] text-white'}`}>
          {msg.type === 'error' ? <AlertTriangle size={16}/> : <CheckCircle2 size={16}/>}
          {msg.text}
        </div>
      )}

      <header className="h-[65px] bg-white border-b border-[#d1fae5] flex items-center justify-between px-5 z-[1000]">
        <div className="flex items-center gap-2">
          <div className="bg-[#10b981] p-1 rounded-lg text-white">
            {isAdmin ? <ShieldCheck size={18}/> : <div className="scale-[0.3] origin-center -m-4"><PrettyClover /></div>}
          </div>
          <span className="text-base font-black text-[#1e293b]">FOUR SEASONS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black bg-[#f0fdf4] text-[#047857] px-3 py-1.5 rounded-full border border-[#d1fae5]">{nickname}</span>
          <button onClick={() => { if(window.confirm("로그아웃 하시겠습니까?")) { localStorage.removeItem('team_nickname'); setNickname(''); signOut(auth); } }} className="p-2 text-slate-300 active:scale-90 transition-all"><LogOut size={18}/></button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <div className={`absolute inset-0 z-10 ${activeTab === 'map' ? 'visible' : 'hidden'}`}>
          <div ref={mapContainerRef} className="w-full h-full" style={{ background: '#f0fdf4' }} />
          <button 
            onClick={() => setActiveTab('add')} 
            className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#1e293b] text-white font-black px-12 py-4 rounded-full z-[1001] shadow-2xl active:scale-95 transition-transform text-sm" 
            style={{ minWidth: '160px', whiteSpace: 'nowrap', display: 'flex', justifyContent: 'center' }}
          >
            기록하기 +
          </button>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto z-[2000] transition-transform duration-300 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-black text-[#1e293b]">NEW RECORD</h2><button onClick={() => { setFormData({...formData, image: null}); setActiveTab('map'); }} className="p-2 bg-white rounded-xl shadow-sm border border-green-50"><X size={24}/></button></div>
          <form onSubmit={handleSave} className="flex flex-col gap-4 pb-12">
             <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => navigator.geolocation.getCurrentPosition(pos => setFormData(prev=>({...prev, customLocation:{lat:pos.coords.latitude, lng:pos.coords.longitude}})))} className="h-24 rounded-[30px] bg-[#1e293b] text-white flex flex-col items-center justify-center gap-1 active:scale-95 transition-all shadow-md"><MapPin size={24} color={formData.customLocation ? "#10b981" : "white"}/><span className="text-[10px] font-black">내 위치 잡기</span></button>
                <div className="relative h-24">
                  <label className="w-full h-full rounded-[30px] bg-white border-2 border-dashed border-[#d1fae5] flex flex-col items-center justify-center gap-1 text-[#10b981] cursor-pointer overflow-hidden active:scale-95 transition-all shadow-sm">
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    {formData.image ? <img src={formData.image} className="w-full h-full object-cover" /> : <><Camera size={24}/><span className="text-[10px] font-black text-center">사진 업로드</span></>}
                  </label>
                  {formData.image && <button type="button" onClick={(e) => { e.preventDefault(); setFormData({...formData, image: null}); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg z-10"><X size={14} /></button>}
                </div>
             </div>
             <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} className="p-4 rounded-2xl border-2 border-slate-100 font-bold bg-white text-[#1e293b] shadow-sm">{GEUMJEONG_AREAS.map(a => <option key={a} value={a}>{a}</option>)}</select>
             <div className="grid grid-cols-2 gap-3">{TRASH_CATEGORIES.map(c => (<button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-4 rounded-2xl border-2 flex items-center gap-2 transition-all ${formData.category === c.id ? 'border-[#10b981] bg-white shadow-inner scale-95' : 'border-transparent bg-white shadow-sm'}`}><span className="text-xl">{c.icon}</span><span className="text-[10px] font-black text-[#1e293b]">{c.label}</span></button>))}</div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 간단히 입력해 주세요." className="p-4 rounded-[30px] h-32 border-2 border-slate-100 outline-none focus:border-[#10b981] text-[#1e293b] shadow-sm resize-none" />
             <button disabled={isUploading} className="bg-[#10b981] text-white p-5 rounded-[30px] font-black text-lg shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all">{isUploading ? <Loader2 className="animate-spin" size={24}/> : "지도에 업로드"}</button>
          </form>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-6 overflow-y-auto ${activeTab === 'list' ? 'visible' : 'hidden'}`}>
           <h2 className="text-xl font-black text-[#1e293b] mb-6">ACTIVITY FEED</h2>
           {reports.length === 0 ? <div className="text-center py-24 text-slate-300 font-black">아직 활동 기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} className="bg-white p-6 rounded-[40px] mb-6 border border-[#d1fae5] shadow-md text-center">
                <div className="flex justify-between items-center mb-4"><span className="text-[10px] font-black text-[#10b981] bg-green-50 px-3 py-1 rounded-full border border-green-100 flex items-center gap-2">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.area}</span><button onClick={() => handleToggleStatus(r.id, r.status)} className={`text-[9px] font-black px-3 py-1 rounded-full shadow-sm transition-all active:scale-90 ${r.status === 'solved' ? 'bg-[#10b981] text-white' : 'bg-slate-100 text-slate-400'}`}>{r.status === 'solved' ? '해결됨 ✓' : '진행중'}</button></div>
                {r.image && <img src={r.image} className="w-full h-48 object-cover rounded-[30px] mb-4 border border-slate-100" />}
                <p className="text-base text-slate-600 leading-relaxed font-semibold px-2 mb-4">{r.description || "내용 없음"}</p>
                <div className="flex justify-between items-center pt-4 border-t border-slate-50"><span className="text-[11px] text-slate-400 font-black flex items-center gap-1.5"><User size={12}/> {r.userName}</span>{(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} className="p-1.5 text-red-200 active:scale-90 transition-all"><Trash2 size={18}/></button>}</div>
             </div>
           ))}
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto ${activeTab === 'stats' ? 'visible' : 'hidden'}`}>
           <h2 className="text-xl font-black text-[#1e293b] mb-8">ACTIVITY STATS</h2>
           <div className="bg-[#1e293b] p-10 rounded-[50px] text-center mb-6 shadow-2xl"><h3 className="text-5xl font-black text-white">{reports.length}</h3><p className="text-[10px] font-black text-[#10b981] tracking-widest uppercase opacity-90">Total Trash Found</p></div>
           <div className="grid grid-cols-2 gap-4 mb-10">
              <div className="bg-white p-8 rounded-[40px] text-center shadow-lg border border-green-50"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-tighter">Solved</p><p className="text-3xl font-black text-[#10b981]">{reports.filter(r=>r.status==='solved').length}</p></div>
              <div className="bg-white p-8 rounded-[40px] text-center shadow-lg border border-green-50"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-tighter">Remaining</p><p className="text-3xl font-black text-slate-800">{reports.filter(r=>r.status!=='solved').length}</p></div>
           </div>
           {isAdmin && (
             <div className="bg-white p-10 rounded-[45px] border-2 border-dashed border-red-100 text-center shadow-md animate-pulse">
                <h4 className="text-red-500 font-black mb-2 flex items-center justify-center gap-2"><AlertTriangle size={20}/> ADMIN TOOLS</h4>
                <p className="text-[10px] text-slate-400 mb-6 font-bold leading-tight text-center">전체 활동 데이터를 즉시 삭제할 수 있습니다.<br/>(삭제된 데이터는 복구가 불가합니다)</p>
                <button 
                  onClick={clearAllData} 
                  className="w-full bg-red-500 text-white p-5 rounded-2xl font-black shadow-lg active:scale-95 transition-transform"
                >
                  데이터 전체 초기화
                </button>
             </div>
           )}
        </div>
      </main>

      <nav className="h-[95px] bg-white border-t border-[#d1fae5] flex justify-around items-center px-4 pb-8 shrink-0 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1.5 ${activeTab === 'map' ? 'text-[#10b981]' : 'text-slate-300'}`}><MapPin size={26} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/><span className="text-[10px] font-black">지도</span></button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-1.5 ${activeTab === 'list' ? 'text-[#10b981]' : 'text-slate-300'}`}><List size={26} strokeWidth={3}/><span className="text-[10px] font-black">피드</span></button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1.5 ${activeTab === 'stats' ? 'text-[#10b981]' : 'text-slate-300'}`}><BarChart3 size={26} strokeWidth={3}/><span className="text-[10px] font-black">통계</span></button>
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