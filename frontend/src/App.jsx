import { useCallback, useEffect, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, BadgeIndianRupee, Bell, Check, ChevronDown, CircleHelp, CreditCard, FileText, LayoutDashboard, LogOut, Plus, RefreshCw, Search, Settings2, ShieldCheck, Users, X } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const money = (minor = 0) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((Number(minor) || 0) / 100)
const niceDate = (raw) => raw ? new Date(`${raw}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function App() {
  const [token, setToken] = useState(localStorage.getItem('brightloop_token') || '')
  const [sessionLoading, setSessionLoading] = useState(Boolean(localStorage.getItem('brightloop_token')))
  const [me, setMe] = useState(null)
  const [view, setView] = useState('Overview')
  const [overview, setOverview] = useState(null)
  const [subscriptions, setSubscriptions] = useState([])
  const [invoices, setInvoices] = useState([])
  const [products, setProducts] = useState([])
  const [plans, setPlans] = useState([])
  const [customers, setCustomers] = useState([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [paymentInvoice, setPaymentInvoice] = useState(null)
  const [loginEmail, setLoginEmail] = useState('admin@brightloop.demo')
  const [loginPassword, setLoginPassword] = useState('Brightloop!2026')
  const [signupName, setSignupName] = useState('')
  const [loginMode, setLoginMode] = useState('login')
  const [filter, setFilter] = useState('')
  const isStaff = me?.role === 'admin' || me?.role === 'staff'
  const isAdmin = me?.role === 'admin'

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    })
    const data = response.status === 204 ? null : await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.detail || 'Something went wrong')
    return data
  }, [token])

  const load = useCallback(async () => {
    if (!token) { setSessionLoading(false); return }
    setSessionLoading(true)
    try {
      const [identity, dash, subs, bills, prods, availablePlans] = await Promise.all([
        request('/auth/me'), request('/overview'), request('/subscriptions'), request('/invoices'), request('/products'), request('/plans'),
      ])
      setMe(identity); setOverview(dash); setSubscriptions(subs); setInvoices(bills); setProducts(prods); setPlans(availablePlans)
      if (identity.role !== 'customer') setCustomers(await request('/customers'))
    } catch (error) {
      if (String(error.message).includes('Session expired') || String(error.message).includes('Sign in')) signOut()
      else setNotice(error.message)
    } finally { setSessionLoading(false) }
  }, [request, token])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 3800); return () => clearTimeout(id) }, [notice])

  function signOut() { localStorage.removeItem('brightloop_token'); setToken(''); setMe(null); setSessionLoading(false) }
  async function login(event) {
    event.preventDefault(); setBusy(true)
    try {
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: loginEmail, password: loginPassword }) })
      localStorage.setItem('brightloop_token', data.access_token); setSessionLoading(true); setToken(data.access_token); setNotice('Welcome back to Brightloop')
    } catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }
  async function signup(event) {
    event.preventDefault(); setBusy(true)
    try {
      const data = await request('/auth/signup', { method: 'POST', body: JSON.stringify({ name: signupName, email: loginEmail, password: loginPassword }) })
      localStorage.setItem('brightloop_token', data.access_token); setSessionLoading(true); setToken(data.access_token); setNotice('Your customer account is ready')
    } catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }
  async function runBilling() {
    setBusy(true)
    try { const data = await request('/billing/run', { method: 'POST' }); setNotice(data.message); await load() }
    catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }
  function recordPayment(invoice) { setPaymentInvoice(invoice) }
  async function submitPayment(event) {
    event.preventDefault()
    const body = Object.fromEntries(new FormData(event.currentTarget).entries())
    const amountMinor = Math.round(Number(body.amount) * 100)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0 || amountMinor > paymentInvoice.balance_minor) {
      setNotice(`Enter an amount up to ${money(paymentInvoice.balance_minor)}`)
      return
    }
    setBusy(true)
    try {
      await request(`/invoices/${paymentInvoice.id}/payments`, { method: 'POST', body: JSON.stringify({ method: body.method, amount_minor: amountMinor, paid_at: new Date(`${body.paid_at}T12:00:00`).toISOString(), note: body.note }) })
      setPaymentInvoice(null); setNotice('Payment recorded'); await load()
    } catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }
  async function submitForm(event, path, onDone) {
    event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form).entries())
    for (const key of ['price_minor', 'cost_minor']) if (body[key] !== undefined) body[key] = Math.round(Number(body[key]) * 100)
    for (const key of ['min_qty', 'customer_id', 'plan_id', 'quantity', 'payment_terms_days']) if (body[key] !== undefined) body[key] = Number(body[key])
    setBusy(true)
    try { await request(path, { method: 'POST', body: JSON.stringify(body) }); form.reset(); setNotice('Saved successfully'); await load(); onDone?.() }
    catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }

  if (token && !me && sessionLoading) return <div className="session-loading" role="status" aria-live="polite"><span className="brand-mark"><Activity size={20}/></span><strong>Opening your workspace…</strong></div>
  if (!token || !me) return <Login email={loginEmail} setEmail={setLoginEmail} password={loginPassword} setPassword={setLoginPassword} name={signupName} setName={setSignupName} mode={loginMode} setMode={setLoginMode} onSubmit={loginMode === 'signup' ? signup : login} busy={busy} notice={notice} />

  const nav = [
    { name: 'Overview', icon: LayoutDashboard },
    ...(isStaff ? [{ name: 'Subscriptions', icon: RefreshCw }, { name: 'Invoices', icon: FileText }, { name: 'Customers', icon: Users }, { name: 'Products & plans', icon: CreditCard }] : [{ name: 'My subscriptions', icon: RefreshCw }, { name: 'My invoices', icon: FileText }]),
  ]
  const filteredSubs = subscriptions.filter(item => `${item.number} ${item.customer_name} ${item.plan_name}`.toLowerCase().includes(filter.toLowerCase()))
  const filteredInvoices = invoices.filter(item => `${item.number} ${item.customer_name} ${item.status}`.toLowerCase().includes(filter.toLowerCase()))

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={20} strokeWidth={2.6} /></span><span>brightloop<span className="brand-dot">.</span><small>SUBSCRIPTION OPS</small></span></div>
      <div className="workspace-label">WORKSPACE</div>
      <button className="workspace-switch"><span className="workspace-icon">B</span><span>Brightloop Software<small>Business account</small></span><ChevronDown size={15} /></button>
      <div className="nav-label">OPERATIONS</div>
      <nav>{nav.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${view === name ? 'active' : ''}`} onClick={() => setView(name)}><Icon size={17} /><span>{name}</span>{name === 'Invoices' && overview?.overdue_count > 0 && <span className="nav-count">{overview.overdue_count}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><CircleHelp size={17} /></span><strong>Need a hand?</strong><p>Your billing workspace is ready to go.</p><button onClick={() => setNotice('Help center is coming soon')}>Visit help center <ArrowUpRight size={13} /></button></div><button className="profile" onClick={signOut}><span className="avatar">{(me.email || 'B')[0].toUpperCase()}</span><span className="profile-text">{me.email}<small>{me.role}</small></span><LogOut size={16} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{view}</strong></div><div className="top-actions"><div className="secure-label"><ShieldCheck size={15} /> All systems operational</div><button className="icon-button" aria-label="Notifications" onClick={() => setNotice('You’re all caught up')}><Bell size={17} /></button><span className="top-avatar">{(me.email || 'B')[0].toUpperCase()}</span></div></header>
      <div className="page-content">
        {view === 'Overview' && <Overview data={overview} invoices={invoices} subs={subscriptions} isStaff={isStaff} busy={busy} onRun={runBilling} onView={setView} onPay={recordPayment} />}
        {(view === 'Subscriptions' || view === 'My subscriptions') && <Subscriptions rows={filteredSubs} isStaff={isStaff} plans={plans} customers={customers} busy={busy} filter={filter} setFilter={setFilter} onCreate={submitForm} />}
        {(view === 'Invoices' || view === 'My invoices') && <Invoices rows={filteredInvoices} isStaff={isStaff} busy={busy} filter={filter} setFilter={setFilter} onPay={recordPayment} />}
        {view === 'Customers' && <Customers rows={customers} busy={busy} onCreate={submitForm} />}
        {view === 'Products & plans' && <Catalog products={products} plans={plans} isAdmin={isAdmin} busy={busy} onCreate={submitForm} />}
      </div>
    </main>
    {paymentInvoice && <PaymentModal invoice={paymentInvoice} busy={busy} onClose={() => setPaymentInvoice(null)} onSubmit={submitPayment}/>}
    {notice && <div className="toast" role="status" aria-live="polite"><span><Check size={15} /></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
  </div>
}

function Login({ email, setEmail, password, setPassword, name, setName, mode, setMode, onSubmit, busy, notice }) {
  return <main className="login-shell"><section className="login-panel"><div className="brand login-brand"><span className="brand-mark"><Activity size={20} strokeWidth={2.6} /></span><span>brightloop<span className="brand-dot">.</span><small>SUBSCRIPTION OPS</small></span></div><div className="login-copy"><div className="eyebrow"><span className="eyebrow-dot" /> BILLING, IN ONE PLACE</div><h1>{mode === 'signup' ? <>A clearer way<br />to <em>subscribe.</em></> : <>Good billing<br />builds <em>trust.</em></>}</h1><p>Manage your plans, customers, and recurring revenue with a little more clarity.</p></div><form className="login-form" onSubmit={onSubmit}>{mode === 'signup' && <label>Your name<input value={name} onChange={e => setName(e.target.value)} required /></label>}<label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button className="primary-button full-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create customer account' : 'Sign in'} <ArrowUpRight size={16} /></button>{notice && <div className="login-error">{notice}</div>}</form>{mode === 'signup' ? <div className="demo-login">Already have an account? <button className="text-button" onClick={() => setMode('login')}>Sign in</button></div> : <div className="demo-login"><span className="demo-dot" /> Demo access is prefilled <span>Admin · Brightloop</span><button className="text-button" onClick={() => { setMode('signup'); setEmail(''); setPassword('') }}>Create account</button></div>}<div className="login-footer">© 2026 Brightloop Software <span>Secure workspace <ShieldCheck size={13} /></span></div></section><section className="login-art"><div className="art-orb orb-one"/><div className="art-orb orb-two"/><div className="art-grid"/><div className="art-content"><div className="art-topline"><span className="art-live"><i/> SAMPLE PREVIEW</span><span>OCT 2026 <ChevronDown size={13}/></span></div><div className="art-amount">₹ 24,86,400<span><ArrowUpRight size={13}/> 12.8%</span></div><div className="art-caption">Monthly recurring revenue</div><div className="chart-wrap"><div className="chart-gridline g1"/><div className="chart-gridline g2"/><div className="chart-gridline g3"/><svg viewBox="0 0 580 180" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#80e1bd" stopOpacity=".25"/><stop offset="1" stopColor="#80e1bd" stopOpacity="0"/></linearGradient></defs><path d="M0,144 C37,137 47,111 82,123 S135,130 167,96 S218,119 249,83 S298,91 327,59 S374,96 407,46 S466,72 497,35 S550,48 580,8 L580,180 L0,180Z" fill="url(#fill)"/><path d="M0,144 C37,137 47,111 82,123 S135,130 167,96 S218,119 249,83 S298,91 327,59 S374,96 407,46 S466,72 497,35 S550,48 580,8" fill="none" stroke="#92e7c5" strokeWidth="3" strokeLinecap="round"/></svg><div className="chart-months"><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span></div></div><div className="art-stats"><div><small>ACTIVE PLANS</small><strong>1,284</strong><span><i/> +8.2% this month</span></div><div><small>COLLECTED</small><strong>₹ 18.2L</strong><span><i/> 94% collection rate</span></div><div><small>RENEWALS</small><strong>96.4%</strong><span><i/> +2.1% this month</span></div></div></div><div className="art-note"><span><Activity size={15}/></span><div><strong>Every renewal, right on time.</strong><small>Subscriptions · invoices · revenue</small></div></div></section></main>
}

function PaymentModal({ invoice, busy, onClose, onSubmit }) {
  const today = new Date().toISOString().slice(0, 10)
  return <div className="modal-backdrop"><section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title"><div className="modal-heading"><div><span className="form-icon green"><CreditCard size={16}/></span><div><h2 id="payment-title">Record a payment</h2><p>{invoice.number} · {invoice.customer_name}</p></div></div><button className="modal-close" aria-label="Close payment form" onClick={onClose}><X size={17}/></button></div><div className="payment-balance"><span>Remaining balance</span><strong>{money(invoice.balance_minor)}</strong></div><form className="stack-form" onSubmit={onSubmit}><label>Amount (₹)<input name="amount" type="number" min="0.01" max={(invoice.balance_minor / 100).toFixed(2)} step="0.01" defaultValue={(invoice.balance_minor / 100).toFixed(2)} required autoFocus/></label><div className="two-col"><label>Payment method<select name="method" defaultValue="Bank transfer"><option>Bank transfer</option><option>Card</option><option>Cash</option><option>Other</option></select></label><label>Payment date<input name="paid_at" type="date" defaultValue={today} required/></label></div><label>Note <span className="optional-label">Optional</span><textarea name="note" rows="2" placeholder="Reference or internal note"/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save payment'} <Check size={15}/></button></div></form></section></div>
}

function PageHeading({ eyebrow, title, desc, action }) { return <div className="page-heading"><div><div className="section-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{desc}</p></div>{action}</div> }
function Metric({ label, value, delta, icon: Icon, tone, foot }) { return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={17}/></span></div><strong>{value}</strong><div className="metric-foot">{delta === '—' ? <span className="metric-neutral">Live</span> : <span className="positive"><ArrowUpRight size={13}/>{delta}</span>}<span>{foot}</span></div></article> }
function Overview({ data, invoices, subs, isStaff, busy, onRun, onView, onPay }) {
  const recent = [...invoices].sort((a,b) => b.id - a.id).slice(0, 5)
  const history = data?.revenue_history || []
  const today = new Date()
  const todayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(today)
  const bins = Array.from({ length: 8 }, (_, index) => {
    const daysAgo = 30 - index * 4
    const nextDaysAgo = Math.max(0, daysAgo - 4)
    const amount = history.reduce((sum, item) => {
      const itemDate = new Date(`${item.day}T00:00:00`)
      const itemDaysAgo = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - itemDate) / 86400000)
      return sum + (itemDaysAgo <= daysAgo && (index === 7 ? itemDaysAgo >= nextDaysAgo : itemDaysAgo > nextDaysAgo) ? item.amount_minor : 0)
    }, 0)
    const labelDate = new Date(today)
    labelDate.setDate(today.getDate() - daysAgo + 2)
    return { amount, label: labelDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }
  })
  const maxBar = Math.max(100, ...bins.map(bin => bin.amount))
  return <><PageHeading eyebrow={todayLabel.toUpperCase()} title="Good morning" desc="Here’s what’s happening across your subscriptions today." action={isStaff && <button className="primary-button" onClick={onRun} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''}/> Run billing</button>} />
    <div className="metric-grid"><Metric label="Monthly recurring revenue" value={money(data?.mrr_minor)} delta="—" foot="current run rate" icon={Activity} tone="green"/><Metric label="Active subscriptions" value={(data?.active_subscriptions || 0).toLocaleString()} delta="—" foot="currently active" icon={RefreshCw} tone="blue"/><Metric label="Collected revenue" value={money(data?.revenue_minor)} delta="—" foot="all recorded payments" icon={ArrowDownLeft} tone="violet"/><Metric label="Outstanding balance" value={money(data?.outstanding_minor)} delta={`${data?.overdue_count || 0} overdue`} foot="needs attention" icon={BadgeIndianRupee} tone="amber"/></div>
    <div className="overview-grid"><section className="panel revenue-panel"><div className="panel-heading"><div><h2>Revenue overview</h2><p>Payments recorded over the last 30 days</p></div><span className="range-pill">Last 30 days</span></div><div className="chart-legend"><span><i className="legend-collected"/> Collected</span><strong>{money(data?.revenue_30d_minor)} <small>last 30 days</small></strong></div>{history.length ? <><div className="bar-chart"><div className="chart-y"><span>{money(maxBar)}</span><span>{money(maxBar / 2)}</span><span>₹0</span></div><div className="bars"><div className="bar-grid bg1"/><div className="bar-grid bg2"/><div className="bar-grid bg3"/>{bins.map((bin,i)=><div className="bar-pair" key={i} title={`${bin.label}: ${money(bin.amount)}`}><span style={{height:`${Math.max(3, bin.amount / maxBar * 86)}%`}}/><small>{bin.label}</small></div>)}</div></div><div className="chart-x"><span>30 days ago</span><span>Today</span></div></> : <div className="chart-empty"><span><Activity size={17}/></span><div><strong>No payments recorded in the last 30 days</strong><small>Once payments are recorded, the collection trend will appear here.</small></div></div>}</section>
      <section className="panel renewals-panel"><div className="panel-heading"><div><h2>Upcoming renewals</h2><p>Subscriptions billing soon</p></div><button className="text-button" onClick={() => onView(isStaff ? 'Subscriptions' : 'My subscriptions')}>View all <ArrowUpRight size={14}/></button></div><div className="renewal-list">{subs.slice(0,4).map((sub,i)=><div className="renewal-row" key={sub.id}><div className={`customer-initial initial-${i%4}`}>{(sub.customer_name||'Y')[0]}</div><div className="renewal-info"><strong>{sub.customer_name || 'Your account'}</strong><small>{sub.plan_name} · {sub.quantity} seats</small></div><div className="renewal-due"><strong>{money(sub.amount_minor)}</strong><small>{niceDate(sub.next_billing_date)}</small></div></div>)}{subs.length === 0 && <Empty message="No subscriptions yet"/>}</div></section></div>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>{isStaff ? 'Recent invoices' : 'Your invoices'}</h2><p>A quick look at your latest billing activity</p></div><button className="text-button" onClick={() => onView(isStaff ? 'Invoices' : 'My invoices')}>All invoices <ArrowUpRight size={14}/></button></div><InvoiceTable rows={recent} isStaff={isStaff} compact onPay={onPay}/></section>
    </>
}
function SearchBox({ value, onChange }) { return <label className="search-box"><Search size={16}/><input placeholder="Search records…" value={value} onChange={e=>onChange(e.target.value)}/><kbd>⌘ K</kbd></label> }
function Subscriptions({ rows, isStaff, plans, customers, busy, filter, setFilter, onCreate }) {
  return <><PageHeading eyebrow="RECURRING REVENUE" title={isStaff ? 'Subscriptions' : 'My subscriptions'} desc="Keep every customer plan and renewal in sync." action={isStaff && <button className="primary-button" onClick={()=>document.getElementById('new-sub')?.scrollIntoView({behavior:'smooth'})}><Plus size={16}/> New subscription</button>}/>
    <div className="list-toolbar"><div className="toolbar-tabs"><button className="selected">All subscriptions <span>{rows.length}</span></button><button>Active</button><button>Closed</button></div><SearchBox value={filter} onChange={setFilter}/></div>
    <section className="panel table-panel"><SubscriptionTable rows={rows} isStaff={isStaff}/></section>
    {isStaff && <section className="panel form-panel" id="new-sub"><div className="form-title"><div><span className="form-icon blue"><Plus size={16}/></span><div><h2>Create a subscription</h2><p>Assign a plan to a customer and set the first billing date.</p></div></div></div><form className="form-grid" onSubmit={e=>onCreate(e,'/subscriptions')}><label>Customer<select name="customer_id" required defaultValue="">{customers.map(c=><option value={c.id} key={c.id}>{c.name} · {c.email}</option>)}</select></label><label>Plan<select name="plan_id" required defaultValue="">{plans.map(p=><option value={p.id} key={p.id}>{p.name} · {money(p.price_minor)}/{p.billing_period==='yearly'?'yr':'mo'}</option>)}</select></label><label>Start date<input name="start_date" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></label><label>Seats / quantity<input name="quantity" type="number" min="1" defaultValue="1" required/></label><label>Payment terms (days)<input name="payment_terms_days" type="number" min="0" defaultValue="14"/></label><div className="form-submit"><button className="primary-button" disabled={busy}>Create subscription <ArrowUpRight size={15}/></button></div></form></section>}
  </>
}
function SubscriptionTable({rows,isStaff}) { return <div className="table-wrap"><table><thead><tr><th>SUBSCRIPTION</th>{isStaff&&<th>CUSTOMER</th>}<th>PLAN</th><th>AMOUNT</th><th>RENEWAL</th><th>STATUS</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong className="mono">{r.number}</strong><small className="cell-sub">Started {niceDate(r.start_date)}</small></td>{isStaff&&<td>{r.customer_name}</td>}<td>{r.plan_name}<small className="cell-sub">{r.quantity} seats · {r.payment_terms_days} day terms</small></td><td><strong>{money(r.amount_minor)}</strong><small className="cell-sub">per billing period</small></td><td>{niceDate(r.next_billing_date)}</td><td><span className="status-pill active"><i/>{r.status}</span></td></tr>)}{!rows.length&&<tr><td colSpan="6"><Empty message="No subscriptions match your search"/></td></tr>}</tbody></table></div> }
function Invoices({ rows, isStaff, busy, filter, setFilter, onPay }) { return <><PageHeading eyebrow="BILLING & COLLECTIONS" title={isStaff ? 'Invoices' : 'My invoices'} desc="Track what’s been billed, paid, and what still needs attention." action={isStaff&&<button className="primary-button" onClick={()=>window.print()}><FileText size={15}/> Print report</button>}/><div className="list-toolbar"><div className="toolbar-tabs"><button className="selected">All invoices <span>{rows.length}</span></button><button>Awaiting payment</button><button>Paid</button></div><SearchBox value={filter} onChange={setFilter}/></div><section className="panel table-panel"><InvoiceTable rows={rows} isStaff={isStaff} onPay={onPay}/></section></> }
function InvoiceTable({rows,isStaff,onPay,compact=false}) { return <div className="table-wrap"><table><thead><tr><th>INVOICE</th>{isStaff&&<th>CUSTOMER</th>}<th>ISSUED / DUE</th><th>AMOUNT</th><th>STATUS</th>{isStaff&&<th></th>}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong className="mono">{r.number}</strong><small className="cell-sub">Subscription {r.subscription_id}</small></td>{isStaff&&<td>{r.customer_name}</td>}<td>{niceDate(r.period_start)}<small className="cell-sub">Due {niceDate(r.due_date)}</small></td><td><strong>{money(r.total_minor)}</strong>{r.balance_minor>0&&<small className="cell-sub">{money(r.balance_minor)} due</small>}</td><td><span className={`status-pill ${r.status==='Paid'?'paid':r.due_date < new Date().toISOString().slice(0,10)?'overdue':'pending'}`}><i/>{r.status==='Paid'?'Paid':r.due_date < new Date().toISOString().slice(0,10)?'Overdue':'Awaiting payment'}</span></td>{isStaff&&<td>{r.status!=='Paid'&&<button className="table-action" onClick={()=>onPay(r)} title="Record payment"><Plus size={14}/> Payment</button>}</td>}</tr>)}{!rows.length&&<tr><td colSpan="6"><Empty message="Invoices appear here after billing runs"/></td></tr>}</tbody></table></div> }
function Customers({rows,busy,onCreate}) { return <><PageHeading eyebrow="CUSTOMER DIRECTORY" title="Customers" desc="The people and teams behind your recurring revenue."/><div className="content-split"><section className="panel table-panel"><div className="panel-heading"><div><h2>All customers</h2><p>{rows.length} customer accounts</p></div></div><div className="customer-list">{rows.map((c,i)=><div className="customer-full-row" key={c.id}><div className={`customer-initial initial-${i%4}`}>{c.name[0]}</div><div><strong>{c.name}</strong><small>{c.email}</small></div><span className="customer-tag">Customer</span></div>)}{!rows.length&&<Empty message="No customer accounts yet"/>}</div></section><section className="panel form-panel compact-form"><div className="form-title"><div><span className="form-icon violet"><Users size={16}/></span><div><h2>Add a customer</h2><p>Create a billing contact.</p></div></div></div><form className="stack-form" onSubmit={e=>onCreate(e,'/customers')}><label>Company or customer name<input name="name" required placeholder="e.g. Acme Studio"/></label><label>Billing email<input name="email" type="email" required placeholder="billing@company.com"/></label><button className="primary-button" disabled={busy}>Add customer <Plus size={15}/></button></form></section></div></> }
function Catalog({products,plans,isAdmin,busy,onCreate}) { return <><PageHeading eyebrow="YOUR OFFERING" title="Products & plans" desc="Manage what you sell and how often customers are billed."/><div className="catalog-grid"><section className="panel form-panel"><div className="form-title"><div><span className="form-icon blue"><CreditCard size={16}/></span><div><h2>New product</h2><p>Define a product and its list price.</p></div></div></div>{isAdmin?<form className="stack-form" onSubmit={e=>onCreate(e,'/products')}><label>Product name<input name="name" required placeholder="Brightloop Analytics"/></label><div className="two-col"><label>Sales price (₹)<input name="price_minor" type="number" min="0" step="0.01" required placeholder="249" onChange={e=>e.target.dataset.minor=e.target.value}/></label><label>Cost price (₹)<input name="cost_minor" type="number" min="0" step="0.01" defaultValue="0"/></label></div><label>Notes<textarea name="notes" rows="2" placeholder="A short product description"/></label><button className="primary-button" disabled={busy}>Create product <Plus size={15}/></button><input type="hidden" name="_currency" value="INR"/></form>:<div className="permission-note"><ShieldCheck size={16}/> Product changes are limited to admins.</div>}</section><section className="panel form-panel"><div className="form-title"><div><span className="form-icon green"><RefreshCw size={16}/></span><div><h2>New plan</h2><p>Choose a product, price, and billing cadence.</p></div></div></div>{isAdmin?<form className="stack-form" onSubmit={e=>onCreate(e,'/plans')}><label>Plan name<input name="name" required placeholder="Growth · Monthly"/></label><label>Product<select name="product_id" required defaultValue="">{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="two-col"><label>Price (₹)<input name="price_minor" type="number" min="0" step="0.01" required/></label><label>Billing interval<select name="billing_period"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label></div><label>Minimum quantity<input name="min_qty" type="number" min="1" defaultValue="1"/></label><button className="primary-button" disabled={busy}>Create plan <Plus size={15}/></button></form>:<div className="permission-note"><ShieldCheck size={16}/> Plan changes are limited to admins.</div>}</section></div><section className="panel table-panel catalog-table"><div className="panel-heading"><div><h2>Available plans</h2><p>Active recurring offers</p></div><span className="subtle-count">{plans.length} plans</span></div><div className="plan-cards">{plans.map((p,i)=><div className="plan-card" key={p.id}><div className={`plan-icon pi-${i%3}`}><CreditCard size={17}/></div><div className="plan-name"><strong>{p.name}</strong><small>{p.product_name} · minimum {p.min_qty}</small></div><div className="plan-price"><strong>{money(p.price_minor)}</strong><small>per {p.billing_period==='yearly'?'year':'month'}</small></div><span className="status-pill active"><i/> Active</span></div>)}{!plans.length&&<Empty message="Add a product and plan to get started"/>}</div></section></> }
function Empty({message}) {return <div className="empty-state"><span><FileText size={18}/></span>{message}</div>}

export default App
