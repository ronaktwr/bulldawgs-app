"use client";
import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function BulldawgsApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [user, setUser] = useState(null);
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [authError, setAuthError] = useState("");

  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Channels State
  const [activeChat, setActiveChat] = useState({ id: 'general-group-123', name: 'Global Deployment' });
  const [agentList, setAgentList] = useState([]);
  const [groupChannels, setGroupChannels] = useState([]);
  
  // NEW: Elite Features State
  const [theme, setTheme] = useState('green'); // 'green' or 'blue'
  const [replyingTo, setReplyingTo] = useState(null);
  
  const messagesEndRef = useRef(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

  // Dynamic Theme Colors
  const tColor = theme === 'green' ? '#39FF14' : '#00E5FF';
  const tBg = theme === 'green' ? 'bg-[#39FF14]' : 'bg-[#00E5FF]';
  const tText = theme === 'green' ? 'text-[#39FF14]' : 'text-[#00E5FF]';
  const tBorder = theme === 'green' ? 'border-[#39FF14]' : 'border-[#00E5FF]';
  const tHover = theme === 'green' ? 'hover:bg-green-400' : 'hover:bg-blue-400';

  const fetchAgents = async () => {
    try {
      const res = await fetch(`${API_URL}/api/users`);
      const data = await res.json();
      setAgentList(data);
    } catch (err) { console.error("Failed to fetch agents"); }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
    const payload = isLoginMode ? { email, password } : { username, email, password, inviteCode };

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || "Authentication failed."); return; }

      setUser(data.user);
      setIsAuthenticated(true);
      fetchAgents();
      
      const newSocket = io(API_URL);
      setSocket(newSocket);
      newSocket.emit('join_chat', activeChat.id);
      
      newSocket.on('load_channels', (channels) => {
        setGroupChannels(channels);
        setActiveChat(prev => {
          const updated = channels.find(c => c.channel_id === prev.id);
          return updated ? { id: prev.id, name: updated.name } : prev;
        });
      });
      
      newSocket.on('load_history', (history) => setMessages(history));
      newSocket.on('receive_message', (msg) => setMessages((prev) => [...prev, msg]));
      
      newSocket.on('message_deleted', ({ messageId, content }) => {
        setMessages((prev) => prev.map(msg => 
          msg.id == messageId ? { ...msg, is_deleted: true, content, media_url: null } : msg
        ));
      });

      newSocket.on('reaction_updated', ({ messageId, reactions }) => {
        setMessages((prev) => prev.map(msg => 
          msg.id == messageId ? { ...msg, reactions } : msg
        ));
      });

      newSocket.on('profile_updated', ({ userId, avatarUrl }) => {
        setAgentList((prev) => prev.map(a => a.id === userId ? { ...a, avatar_url: avatarUrl } : a));
        if (data.user.id === userId) setUser(prev => ({ ...prev, avatar_url: avatarUrl }));
      });

    } catch (err) { setAuthError("Server unreachable."); }
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const switchChat = (chatId, chatName) => {
    if (activeChat.id === chatId || !socket) return;
    socket.emit('leave_chat', activeChat.id);
    setMessages([]);
    setReplyingTo(null);
    setActiveChat({ id: chatId, name: chatName });
    socket.emit('join_chat', chatId);
  };

  const handleCreateGroup = () => {
    const groupName = prompt("Enter the name for the new secure group:");
    if (groupName && groupName.trim() !== "" && socket) {
      socket.emit('create_channel', groupName.trim());
    }
  };

  const handleRenameGroup = (e, channelId, currentName) => {
    e.stopPropagation();
    const newName = prompt(`Enter new name for "${currentName}":`, currentName);
    if (newName && newName.trim() !== "" && newName !== currentName && socket) {
      socket.emit('rename_channel', { channelId, newName: newName.trim() });
    }
  };

  // UPLOAD LOGIC (Media OR Avatar)
  const uploadFile = async (fileToUpload) => {
    const fileName = `${Math.random().toString(36).substring(7)}.${fileToUpload.name.split('.').pop()}`;
    const filePath = `uploads/${fileName}`;
    const { error } = await supabase.storage.from('bulldawgs_media').upload(filePath, fileToUpload);
    if (error) return null;
    const { data } = supabase.storage.from('bulldawgs_media').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !socket) return;
    const avatarUrl = await uploadFile(file);
    if (avatarUrl) socket.emit('update_profile', { userId: user.id, avatarUrl });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if ((!input.trim() && !file) || !socket || isUploading) return;
    setIsUploading(true);
    let mediaUrl = file ? await uploadFile(file) : null;
    
    socket.emit('send_message', {
      chatId: activeChat.id,
      senderId: user.id,
      senderName: user.username,
      content: input || (mediaUrl ? "Shared Media Transmission" : ""),
      mediaUrl: mediaUrl,
      replyToId: replyingTo ? replyingTo.id : null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    
    setInput("");
    setFile(null);
    setReplyingTo(null);
    setIsUploading(false);
  };

  const deleteMessage = (messageId, senderId) => {
    if (!socket || !messageId) return;
    socket.emit('delete_message', { chatId: activeChat.id, messageId, senderId, isAdmin: user.is_admin });
  };

  const toggleReaction = (messageId, currentReactions, emoji) => {
    if (!socket || !messageId) return;
    const reactions = currentReactions || {};
    const hasReacted = reactions[emoji]?.includes(user.id);
    
    if (hasReacted) {
      reactions[emoji] = reactions[emoji].filter(id => id !== user.id);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...(reactions[emoji] || []), user.id];
    }
    socket.emit('update_reaction', { chatId: activeChat.id, messageId, reactions });
  };

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white p-4">
        <div className="w-full max-w-md p-8 rounded-2xl bg-[#0a0a0a] border border-white/10 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black tracking-widest text-[#39FF14] mb-2">BULLDAWGS</h1>
            <p className="text-sm text-gray-400 uppercase tracking-widest">Restricted Access</p>
          </div>
          {authError && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-500 text-sm text-center">{authError}</div>}
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLoginMode && (
              <>
                <div><label className="text-xs text-gray-400 font-bold uppercase">Username</label><input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full mt-1 bg-[#1a1a1a] text-white rounded-lg px-4 py-3 text-sm border border-white/5" /></div>
                <div><label className="text-xs text-gray-400 font-bold uppercase">Invite Code</label><input type="text" required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="w-full mt-1 bg-[#1a1a1a] text-[#39FF14] font-mono rounded-lg px-4 py-3 text-sm border border-white/5 uppercase" /></div>
              </>
            )}
            <div><label className="text-xs text-gray-400 font-bold uppercase">Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mt-1 bg-[#1a1a1a] text-white rounded-lg px-4 py-3 text-sm border border-white/5" /></div>
            <div><label className="text-xs text-gray-400 font-bold uppercase">Password</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mt-1 bg-[#1a1a1a] text-white rounded-lg px-4 py-3 text-sm border border-white/5" /></div>
            <button type="submit" className="w-full mt-6 bg-[#39FF14] text-black rounded-lg px-4 py-3 font-bold">{isLoginMode ? 'INITIALIZE CONNECTION' : 'VERIFY & REGISTER'}</button>
          </form>
          <div className="mt-6 text-center">
            <button onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(""); }} className="text-xs text-gray-500 hover:text-[#39FF14] transition underline">{isLoginMode ? "No access? Enter invite code." : "Already an agent? Login here."}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-80 border-r border-white/10 bg-[#0a0a0a] flex-col hidden md:flex">
        <div className="p-6 border-b border-white/10 flex justify-between items-start">
          <div>
            <h1 className={`text-2xl font-black tracking-widest ${tText}`}>BULLDAWGS</h1>
            <div className="flex items-center gap-2 mt-2">
              <label className="cursor-pointer relative group">
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
                <div className={`w-8 h-8 rounded-full bg-[#1a1a1a] border ${tBorder} flex items-center justify-center overflow-hidden`}>
                  {user?.avatar_url ? <img src={user.avatar_url} className="w-full h-full object-cover" /> : "👤"}
                </div>
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><span className="text-[8px]">EDIT</span></div>
              </label>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">{user?.username} {user?.is_admin && <span className="text-red-500 font-bold ml-1" title="Commander Privileges Active">★</span>}</p>
              </div>
            </div>
          </div>
          {/* Theme Toggle */}
          <button onClick={() => setTheme(theme === 'green' ? 'blue' : 'green')} className="text-xs text-gray-600 hover:text-white" title="Toggle Theme">
            {theme === 'green' ? '🟢' : '🔵'}
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <div className="flex justify-between items-center mb-3 px-2">
              <h3 className="text-xs text-gray-500 font-bold uppercase tracking-widest">Group Channels</h3>
              <button onClick={handleCreateGroup} className={`${tText} hover:text-white font-bold text-lg leading-none transition`} title="Create New Group">+</button>
            </div>
            {groupChannels.map((chat) => (
              <div key={chat.channel_id} onClick={() => switchChat(chat.channel_id, chat.name)} 
                   className={`group p-3 mb-1 rounded-lg cursor-pointer transition flex justify-between items-center ${activeChat.id === chat.channel_id ? `${tBg}/10 border ${tBorder}/50` : 'hover:bg-white/5 border border-transparent'}`}>
                <div className="flex items-center gap-3">
                  <span className={activeChat.id === chat.channel_id ? tText : "text-gray-500"}>#</span>
                  <span className={`font-bold ${activeChat.id === chat.channel_id ? tText : 'text-gray-300'}`}>{chat.name}</span>
                </div>
                {user.is_admin && (
                  <button onClick={(e) => handleRenameGroup(e, chat.channel_id, chat.name)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white transition text-xs" title="Rename Group">✎</button>
                )}
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-3 px-2">Direct Messages</h3>
            {agentList.filter(agent => agent.id !== user.id).map(agent => {
              const dmId = `dm_${[String(user.id), String(agent.id)].sort().join('_')}`;
              const isActive = activeChat.id === dmId;
              return (
                <div key={agent.id} onClick={() => switchChat(dmId, agent.username)} 
                     className={`p-3 mb-1 rounded-lg cursor-pointer transition flex items-center gap-3 ${isActive ? `${tBg}/10 border ${tBorder}/50` : 'hover:bg-white/5 border border-transparent'}`}>
                  <div className={`w-6 h-6 rounded-full bg-[#1a1a1a] border border-gray-600 flex items-center justify-center overflow-hidden`}>
                    {agent.avatar_url ? <img src={agent.avatar_url} className="w-full h-full object-cover" /> : <span className="text-[10px]">👤</span>}
                  </div>
                  <span className={`font-bold ${isActive ? tText : 'text-gray-300'}`}>
                    {agent.username} {agent.is_admin && <span className="text-red-500 text-[10px] ml-1">★</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* CHAT AREA */}
      <main className="flex-1 flex flex-col relative bg-[#0a0a0a]">
        <header className="p-5 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur-md z-10 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-lg text-white">{activeChat.name}</h2>
            <p className="text-xs text-gray-500">Secure Channel Active</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg, index) => {
            const isMe = msg.sender_id === user.id || msg.senderId === user.id;
            const senderAgent = agentList.find(a => a.id === msg.sender_id);
            const canDelete = isMe || user.is_admin;
            const replyOrigin = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;

            return (
              <div key={index} className={`flex ${isMe ? 'justify-end' : 'justify-start'} gap-3 group`}>
                {!isMe && (
                   <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-gray-600 flex-shrink-0 flex items-center justify-center overflow-hidden mt-4">
                     {senderAgent?.avatar_url ? <img src={senderAgent.avatar_url} className="w-full h-full object-cover" /> : "👤"}
                   </div>
                )}
                
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]`}>
                  <span className={`text-[10px] text-gray-500 mb-1 px-1`}>
                    {isMe ? 'You' : msg.sender_name || msg.senderName}
                  </span>
                  
                  <div className={`rounded-2xl px-5 py-3 shadow-xl relative transition-all ${
                    msg.is_deleted ? 'bg-transparent border border-red-500/30 text-red-500/80 italic' : 
                    isMe ? `${tBg} text-black rounded-tr-sm` : 'bg-[#1a1a1a] text-gray-200 rounded-tl-sm border border-white/10'
                  }`}>
                    
                    {/* Hover Actions: Reply & Delete */}
                    {!msg.is_deleted && msg.id && (
                      <div className={`absolute -top-3 ${isMe ? 'left-0 -ml-8' : 'right-0 -mr-8'} opacity-0 group-hover:opacity-100 transition flex gap-1 bg-[#0a0a0a] border border-white/10 rounded-full p-1 shadow-lg`}>
                        <button onClick={() => setReplyingTo(msg)} className="w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-gray-800" title="Reply">↩️</button>
                        {canDelete && <button onClick={() => deleteMessage(msg.id, msg.sender_id)} className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-red-500 hover:bg-red-500/20 font-bold" title="Redact">X</button>}
                      </div>
                    )}

                    {/* Reply Display */}
                    {replyOrigin && (
                      <div className={`text-xs p-2 mb-2 rounded-lg opacity-80 ${isMe ? 'bg-black/20 border border-black/10' : 'bg-black/40 border border-white/5'}`}>
                        <span className="font-bold">{replyOrigin.sender_name}: </span>
                        {replyOrigin.is_deleted ? '🚫 Redacted' : replyOrigin.content}
                      </div>
                    )}

                    {msg.media_url && !msg.is_deleted && (
                      <img src={msg.media_url} alt="Upload" className="max-w-full h-auto rounded-lg mb-3 border border-black/10 shadow-sm" />
                    )}
                    
                    <p className="text-sm md:text-base leading-relaxed break-words">{msg.content}</p>
                    
                    {/* Emoji Reaction Bar */}
                    {!msg.is_deleted && msg.id && (
                       <div className="absolute -bottom-4 left-4 flex gap-1">
                          {['🔥', '👍', '👀'].map(emoji => (
                             <button key={emoji} onClick={() => toggleReaction(msg.id, msg.reactions, emoji)} className={`text-[10px] bg-[#1a1a1a] border ${msg.reactions?.[emoji]?.includes(user.id) ? tBorder : 'border-gray-700'} rounded-full px-2 py-0.5 opacity-0 group-hover:opacity-100 transition shadow-lg ${msg.reactions?.[emoji]?.length > 0 ? 'opacity-100' : ''}`}>
                               {emoji} {msg.reactions?.[emoji]?.length > 0 && msg.reactions[emoji].length}
                             </button>
                          ))}
                       </div>
                    )}

                    <div className={`text-[10px] mt-2 text-right ${msg.is_deleted ? 'text-red-500/50' : isMe ? 'text-black/60 font-bold' : 'text-gray-500'}`}>
                      {msg.timestamp}
                    </div>
                  </div>
                </div>

                {isMe && (
                   <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-gray-600 flex-shrink-0 flex items-center justify-center overflow-hidden mt-4">
                     {user?.avatar_url ? <img src={user.avatar_url} className="w-full h-full object-cover" /> : "👤"}
                   </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA */}
        <div className="p-4 bg-[#0a0a0a] border-t border-white/10 relative">
          {replyingTo && (
            <div className={`absolute -top-10 left-4 right-4 ${tBg}/10 border border-${theme === 'green' ? '[#39FF14]' : '[#00E5FF]'}/30 rounded-t-xl p-2 text-xs text-gray-300 flex justify-between items-center px-4 backdrop-blur-md`}>
              <span>Replying to <span className="font-bold text-white">{replyingTo.sender_name}</span>: {replyingTo.content.substring(0, 50)}...</span>
              <button onClick={() => setReplyingTo(null)} className="text-red-500 hover:text-red-400 font-bold text-lg">×</button>
            </div>
          )}
          <form onSubmit={sendMessage} className="flex gap-3 items-center max-w-4xl mx-auto">
            <input type="file" id="media-upload" className="hidden" accept="image/*,video/*" onChange={(e) => setFile(e.target.files[0])} />
            <label htmlFor="media-upload" className={`p-4 rounded-xl cursor-pointer transition flex items-center justify-center font-bold text-lg ${file ? `${tBg} text-black` : `bg-[#1a1a1a] text-gray-400 ${tHover} border border-white/5`}`}>
              {file ? '✓' : '📎'}
            </label>
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={file ? `Attached: ${file.name}` : "Transmit secure message..."} className="flex-1 bg-[#1a1a1a] text-white rounded-xl px-5 py-4 text-sm focus:outline-none border border-white/5 shadow-inner" disabled={isUploading} />
            <button type="submit" disabled={(!input.trim() && !file) || isUploading} className={`${tBg} text-black rounded-xl p-4 ${tHover} transition font-bold disabled:opacity-50`}>
              {isUploading ? 'UPLOADING...' : 'SEND'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}