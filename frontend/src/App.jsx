import { useCallback, useEffect, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, BadgeIndianRupee, Bell, Check, ChevronDown, CircleHelp, CreditCard, FileText, LayoutDashboard, LogOut, Plus, RefreshCw, Search, ShieldCheck, Users, X, Eye, EyeOff, CheckCircle2, Circle, Percent, Send, Mail, Tag, Ban } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const money = (minor = 0) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((Number(minor) || 0) / 100)
const niceDate = (raw) => raw ? new Date(`${raw}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function App() {
  const [token, setToken] = useState(localStorage.getItem('brightloop_token') || '')
  const [sessionLoading, setSessionLoading] = useState(Boolean(localStorage.getItem('brightloop_token')))
  const [me, setMe] = useState(null)
  const [view, setView] = useState('Dashboard')
  const [pages, setPages] = useState({ subscriptions: 1, invoices: 1, payments: 1, customers: 1, products: 1, plans: 1, templates: 1 })
  const [pageInfo, setPageInfo] = useState({})
  const [payments, setPayments] = useState([])
  const [search, setSearch] = useState('')
  const [overview, setOverview] = useState(null)
  const [subscriptions, setSubscriptions] = useState([])
  const [invoices, setInvoices] = useState([])
  const [products, setProducts] = useState([])
  const [plans, setPlans] = useState([])
  const [customers, setCustomers] = useState([])
  const [templates, setTemplates] = useState([])
  const [taxes, setTaxes] = useState([])
  const [discounts, setDiscounts] = useState([])
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('All')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [paymentInvoice, setPaymentInvoice] = useState(null)
  const [billingOpen, setBillingOpen] = useState(false)
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [detailRefresh, setDetailRefresh] = useState(0)
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
      const query = key => `?page=${pages[key]}&page_size=25&search=${encodeURIComponent(search)}`
      const [identity, dash, subs, bills, paid, prods, availablePlans] = await Promise.all([
        request('/auth/me'), request('/overview'), request(`/subscriptions${query('subscriptions')}`), request(`/invoices${query('invoices')}`), request(`/payments${query('payments')}`), request(`/products${query('products')}`), request(`/plans${query('plans')}`),
      ])
      setMe(identity); setOverview(dash); setSubscriptions(subs.items); setInvoices(bills.items); setPayments(paid.items); setProducts(prods.items); setPlans(availablePlans.items)
      setPageInfo({ subscriptions: subs, invoices: bills, payments: paid, products: prods, plans: availablePlans })
      if (identity.role !== 'customer') {
        const customerPage = await request(`/customers${query('customers')}`)
        setCustomers(customerPage.items); setPageInfo(current => ({ ...current, customers: customerPage }))
        const templatePage = await request(`/templates${query('templates')}`)
        setTemplates(templatePage.items); setPageInfo(current => ({ ...current, templates: templatePage }))
        const [taxList, discountList] = await Promise.all([request('/taxes'), request('/discounts')])
        setTaxes(taxList); setDiscounts(discountList)
      }
      if (identity.role === 'customer' && view === 'Dashboard') setView('My subscriptions')
    } catch (error) {
      if (String(error.message).includes('Session expired') || String(error.message).includes('Sign in')) signOut()
      else setNotice(error.message)
    } finally { setSessionLoading(false) }
  }, [request, token, pages, search, view])

  useEffect(() => { load() }, [load])
  useEffect(() => { const timer = setTimeout(() => setSearch(filter), 300); return () => clearTimeout(timer) }, [filter])
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 3800); return () => clearTimeout(id) }, [notice])

  function goToPage(key, page) { setPages(current => ({ ...current, [key]: page })) }
  function openSubscription(id) { setSelectedSubscriptionId(id); setView('Subscription detail') }
  function openInvoice(id) { setSelectedInvoiceId(id); setView('Invoice detail') }
  
  async function transitionSubscription(id, to) {
    setBusy(true)
    try { await request(`/subscriptions/${id}/transition`, { method: 'POST', body: JSON.stringify({ to }) }); setDetailRefresh(value => value + 1); setNotice(`Subscription moved to ${to}`); await load() }
    catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }

  async function generateSubscriptionInvoice(id, asDraft = false) {
    setBusy(true)
    try {
      const res = await request(`/subscriptions/${id}/invoice?as_draft=${asDraft}`, { method: 'POST' })
      setDetailRefresh(v => v + 1)
      setNotice(`Invoice ${res.number} generated (${res.status})`)
      await load()
      openInvoice(res.id)
    } catch (err) { setNotice(err.message) } finally { setBusy(false) }
  }

  async function confirmInvoice(id) {
    setBusy(true)
    try {
      await request(`/invoices/${id}/confirm`, { method: 'POST' })
      setDetailRefresh(v => v + 1)
      setNotice('Invoice confirmed')
      await load()
    } catch (err) { setNotice(err.message) } finally { setBusy(false) }
  }

  async function cancelInvoice(id) {
    setBusy(true)
    try {
      await request(`/invoices/${id}/cancel`, { method: 'POST' })
      setDetailRefresh(v => v + 1)
      setNotice('Invoice cancelled')
      await load()
    } catch (err) { setNotice(err.message) } finally { setBusy(false) }
  }

  async function restoreInvoice(id) {
    setBusy(true)
    try {
      const restored = await request(`/invoices/${id}/restore`, { method: 'POST' })
      setDetailRefresh(v => v + 1)
      setNotice(`Invoice restored as ${restored.number}; confirm before sending`)
      await load()
    } catch (err) { setNotice(err.message) } finally { setBusy(false) }
  }

  async function sendInvoiceEmail(id) {
    setBusy(true)
    try {
      const res = await request(`/invoices/${id}/send`, { method: 'POST' })
      setDetailRefresh(v => v + 1)
      setNotice(`Invoice dispatch logged for ${res.customer_email || 'customer'} (email service is not configured)`)
      await load()
    } catch (err) { setNotice(err.message) } finally { setBusy(false) }
  }

  async function toggleTax(id) {
    setBusy(true)
    try {
      await request(`/taxes/${id}/toggle`, { method: 'PATCH' })
      setNotice('Tax rule updated')
      const taxList = await request('/taxes')
      setTaxes(taxList)
    } catch (err) { setNotice(err.message) } finally { setBusy(false) }
  }

  async function toggleDiscount(id) {
    setBusy(true)
    try {
      await request(`/discounts/${id}/toggle`, { method: 'PATCH' })
      setNotice('Discount rule updated')
      const discountList = await request('/discounts')
      setDiscounts(discountList)
    } catch (err) { setNotice(err.message) } finally { setBusy(false) }
  }

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
  async function runBilling(asOf) {
    setBusy(true)
    try { const data = await request('/billing/run', { method: 'POST', body: JSON.stringify({ as_of: asOf }) }); setBillingOpen(false); setNotice(`Billing complete · ${data.created} created, ${data.skipped} skipped, ${data.failed} failed`); await load() }
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
      setPaymentInvoice(null); setDetailRefresh(value => value + 1); setNotice('Payment recorded'); await load()
    } catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }
  async function submitForm(event, path, onDone) {
    event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form).entries())
    for (const key of ['price_minor', 'cost_minor', 'min_amount_minor']) if (body[key] !== undefined) body[key] = Math.round(Number(body[key]) * 100)
    for (const key of ['min_qty', 'customer_id', 'plan_id', 'quantity', 'payment_terms_days', 'tax_id', 'discount_id']) if (body[key] !== undefined) body[key] = body[key] ? Number(body[key]) : null
    if (body.product_id !== undefined) body.product_id = body.product_id === '' ? null : Number(body.product_id)
    if (body.usage_limit === '') body.usage_limit = null
    for (const key of ['rate_percent', 'value']) if (body[key] !== undefined) body[key] = Number(body[key] || 0)
    for (const key of ['auto_close', 'closable', 'pausable', 'renewable', 'is_default', 'auto_apply']) body[key] = form.elements.namedItem(key)?.checked ?? false
    for (const key of ['starts_on', 'ends_on']) if (body[key] === '') body[key] = null
    if (path === '/products' && body.variants_text) body.variants = body.variants_text.split('\n').map(row => row.trim()).filter(Boolean).map(row => { const [attribute, raw] = row.split('='); const [value, extra='0'] = (raw || '').split('|'); return { attribute: attribute.trim(), value: value.trim(), extra_price_minor: Math.round(Number(extra.trim()) * 100) } }).filter(v => v.attribute && v.value)
    delete body.variants_text
    setBusy(true)
    try { await request(path, { method: 'POST', body: JSON.stringify(body) }); form.reset(); setNotice('Saved successfully'); await load(); onDone?.() }
    catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }
  async function submitTemplate(body) {
    setBusy(true)
    try { await request('/templates', { method: 'POST', body: JSON.stringify(body) }); setNotice('Quotation template created'); await load() }
    catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }

  if (token && !me && sessionLoading) return <div className="session-loading" role="status" aria-live="polite"><span className="brand-mark"><Activity size={20}/></span><strong>Opening your workspace…</strong></div>
  if (!token || !me) return <Login email={loginEmail} setEmail={setLoginEmail} password={loginPassword} setPassword={setLoginPassword} name={signupName} setName={setSignupName} mode={loginMode} setMode={setLoginMode} onSubmit={loginMode === 'signup' ? signup : login} busy={busy} notice={notice} />

  const nav = isAdmin ? [
    { name: 'Dashboard', icon: LayoutDashboard }, { name: 'Subscriptions', icon: RefreshCw }, { name: 'Invoices', icon: FileText }, { name: 'Billing rules', icon: Percent }, { name: 'Payments', icon: BadgeIndianRupee }, { name: 'Customers', icon: Users }, { name: 'Products', icon: CreditCard }, { name: 'Plans', icon: CreditCard }, { name: 'Templates', icon: FileText },
  ] : isStaff ? [
    { name: 'Dashboard', icon: LayoutDashboard }, { name: 'Subscriptions', icon: RefreshCw }, { name: 'Invoices', icon: FileText }, { name: 'Billing rules', icon: Percent }, { name: 'Payments', icon: BadgeIndianRupee }, { name: 'Customers', icon: Users },
  ] : [
    { name: 'My subscriptions', icon: RefreshCw }, { name: 'My invoices', icon: FileText },
  ]

  const filteredSubs = subscriptions
  const filteredInvoices = invoices.filter(inv => {
    if (invoiceStatusFilter === 'All') return true
    if (invoiceStatusFilter === 'Overdue') return inv.status !== 'Paid' && inv.status !== 'Cancelled' && inv.due_date < new Date().toISOString().slice(0, 10)
    return inv.status === invoiceStatusFilter
  })

  return <div className={`app-shell ${me.role === 'customer' ? 'customer-shell' : ''}`}>
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
        {view === 'Subscription detail' && <SubscriptionDetail id={selectedSubscriptionId} request={request} refresh={detailRefresh} busy={busy} onBack={()=>setView(isStaff?'Subscriptions':'My subscriptions')} onTransition={transitionSubscription} onOpenInvoice={openInvoice} onGenerateInvoice={generateSubscriptionInvoice} isStaff={isStaff}/>}
        {view === 'Invoice detail' && <InvoiceDetail id={selectedInvoiceId} request={request} refresh={detailRefresh} isStaff={isStaff} onBack={()=>setView(isStaff?'Invoices':'My invoices')} onPay={recordPayment} onConfirm={confirmInvoice} onCancel={cancelInvoice} onRestore={restoreInvoice} onSend={sendInvoiceEmail} busy={busy}/>}
        {view === 'Dashboard' && <Overview data={overview} invoices={invoices} payments={payments} subs={subscriptions} isStaff={isStaff} busy={busy} onRun={() => setBillingOpen(true)} onView={setView} onPay={recordPayment} onOpenInvoice={openInvoice} onOpenSubscription={openSubscription} />}
        {(view === 'Subscriptions' || view === 'My subscriptions') && <Subscriptions rows={filteredSubs} isStaff={isStaff} plans={plans} customers={customers} templates={templates} taxes={taxes} discounts={discounts} busy={busy} filter={filter} setFilter={setFilter} onCreate={submitForm} page={pageInfo.subscriptions} onPage={page => goToPage('subscriptions', page)} onOpen={openSubscription} />}
        {(view === 'Invoices' || view === 'My invoices') && <Invoices rows={filteredInvoices} rawInvoices={invoices} isStaff={isStaff} busy={busy} filter={filter} setFilter={setFilter} statusFilter={invoiceStatusFilter} setStatusFilter={setInvoiceStatusFilter} onPay={recordPayment} onRun={() => setBillingOpen(true)} onConfirm={confirmInvoice} onSend={sendInvoiceEmail} onOpen={openInvoice} page={pageInfo.invoices} onPage={page => goToPage('invoices', page)} />}
        {view === 'Billing rules' && isStaff && <BillingRules taxes={taxes} discounts={discounts} products={products} busy={busy} onToggleTax={toggleTax} onToggleDiscount={toggleDiscount} onCreate={submitForm} isAdmin={isAdmin} />}
        {view === 'Customers' && <Customers rows={customers} busy={busy} onCreate={submitForm} page={pageInfo.customers} onPage={page => goToPage('customers', page)} />}
        {(view === 'Products' || view === 'Plans') && <Catalog products={products} plans={plans} isAdmin={isAdmin} busy={busy} onCreate={submitForm} pageInfo={pageInfo} onPage={goToPage} view={view} />}{view === 'Payments' && <Payments rows={payments} page={pageInfo.payments} onPage={page => goToPage('payments', page)} />}{view === 'Templates' && isAdmin && <Templates templates={templates} products={products} plans={plans} busy={busy} onCreate={submitTemplate} />}
      </div>
    </main>
    {paymentInvoice && <PaymentModal invoice={paymentInvoice} busy={busy} onClose={() => setPaymentInvoice(null)} onSubmit={submitPayment}/>}
    {billingOpen && <BillingModal request={request} busy={busy} onClose={() => setBillingOpen(false)} onRun={runBilling}/>}
    {notice && <div className="toast" role="status" aria-live="polite"><span><Check size={15} /></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
  </div>
}

function Login({ email, setEmail, password, setPassword, name, setName, mode, setMode, onSubmit, busy, notice }) {
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const rules = [
    ['At least 9 characters', password.length > 8],
    ['One uppercase letter', /[A-Z]/.test(password)],
    ['One lowercase letter', /[a-z]/.test(password)],
    ['One special character', /[^A-Za-z0-9]/.test(password)],
  ]
  const signupReady = rules.every(([,valid])=>valid) && password === confirmPassword && Boolean(name.trim()) && Boolean(email.trim())
  return <main className="login-shell"><section className="login-panel"><div className="brand login-brand"><span className="brand-mark"><Activity size={20} strokeWidth={2.6} /></span><span>brightloop<span className="brand-dot">.</span><small>SUBSCRIPTION OPS</small></span></div>
    <div className="login-copy"><div className="eyebrow"><span className="eyebrow-dot" /> BILLING, IN ONE PLACE</div><h1>{mode === 'signup' ? <>A clearer way<br/>to <em>subscribe.</em></> : <>Good billing<br/>builds <em>trust.</em></>}</h1><p>Manage your plans, customers, and recurring revenue with a little more clarity.</p></div>
    <form className="login-form" onSubmit={onSubmit}>
      {mode === 'signup' && <label>Your name<input value={name} onChange={e=>setName(e.target.value)} autoComplete="name" required/></label>}
      <label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required aria-invalid={Boolean(notice && notice.toLowerCase().includes('email'))}/>{notice && notice.toLowerCase().includes('email') && <small className="field-error">{notice}</small>}</label>
      <label>Password<PasswordInput value={password} onChange={e=>setPassword(e.target.value)} show={showPassword} toggle={()=>setShowPassword(v=>!v)} autoComplete={mode==='signup'?'new-password':'current-password'}/></label>
      {mode === 'signup' && <><div className="password-rules" aria-live="polite">{rules.map(([label,valid])=><span key={label} className={valid?'valid':''}>{valid?<CheckCircle2 size={13}/>:<Circle size={13}/>} {label}</span>)}</div><label>Confirm password<input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" required aria-describedby="password-match"/></label><small id="password-match" className={confirmPassword && password!==confirmPassword?'field-error':'helper-text'}>{confirmPassword && password!==confirmPassword?'Passwords do not match':'Re-enter your password to confirm.'}</small></>}
      <button className="primary-button full-button" disabled={busy || (mode==='signup' && !signupReady)}>{busy ? 'Please wait…' : mode==='signup' ? 'Create customer account' : 'Sign in'} <ArrowUpRight size={16} /></button>
      {notice && !notice.toLowerCase().includes('email') && <div className="login-error" role="alert">{notice}</div>}
      <div className="demo-login"><span className="demo-dot"/> Demo admin: admin@brightloop.demo <span>Brightloop!2026</span></div>
      <div className="demo-login"><span className="demo-dot"/> Demo client: billing@northstar.example <span>Customer!2026</span></div>
      <div className="demo-login"><button type="button" className="text-button" onClick={()=>setMode(mode==='signup'?'login':'signup')}>{mode==='signup'?'Existing customer? Sign in instead':'Create new customer account'}</button></div>
    </form><footer className="login-footer"><span><ShieldCheck size={14}/> SOC2 Type II Certified</span><span>256-bit TLS encrypted</span></footer></section>
  <div className="login-art" aria-hidden="true"><div className="art-grid"/><div className="art-orb orb-one"/><div className="art-orb orb-two"/><div className="art-content"><div className="art-topline"><span><span className="brand-mark"><Activity size={16}/></span> Brightloop Platform</span><span className="art-live"><i/> Live Billing</span></div><div className="art-amount">₹4,28,450 <span>+18.4%</span></div><div className="art-caption">Recurring billings processed this period</div><div className="chart-wrap"><div className="chart-gridline g1"/><div className="chart-gridline g2"/><div className="chart-gridline g3"/><svg viewBox="0 0 400 120" preserveAspectRatio="none"><path d="M0,90 Q80,75 140,50 T280,35 T400,10" fill="none" stroke="#4cd299" strokeWidth="3"/></svg><div className="chart-months"><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span></div></div><div className="art-stats"><div><small>ACTIVE PLANS</small><strong>12</strong><span><i></i> Enterprise</span></div><div><small>COLLECTION RATE</small><strong>99.2%</strong><span><i></i> High confidence</span></div><div><small>NEXT RUN</small><strong>Today</strong><span><i></i> Auto cutoff</span></div></div></div><div className="art-note"><span><CreditCard size={15}/></span><div><strong>Smart Tax & Discount Automation</strong><small>Rules automatically applied during recurring billing</small></div></div></div></main>
}

function PasswordInput({value,onChange,show,toggle,autoComplete}) { return <span className="password-wrap"><input type={show?'text':'password'} value={value} onChange={onChange} autoComplete={autoComplete} required/><button type="button" className="password-toggle" aria-label={show?'Hide password':'Show password'} onClick={toggle}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button></span> }
function BillingModal({request,busy,onClose,onRun}) {
  const [asOf,setAsOf] = useState(new Date().toISOString().slice(0,10))
  const [preview,setPreview] = useState(null)
  const [error,setError] = useState('')
  useEffect(()=>{let current=true;setPreview(null);setError('');request(`/billing/preview?as_of=${asOf}`).then(data=>{if(current)setPreview(data)}).catch(err=>{if(current)setError(err.message)});return()=>{current=false}},[asOf,request])
  return <div className="modal-backdrop"><section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="billing-title"><div className="modal-heading"><div><span className="form-icon blue"><RefreshCw size={16}/></span><div><h2 id="billing-title">Run subscription billing</h2><p>Review subscriptions due through a cutoff date.</p></div></div><button className="modal-close" aria-label="Close billing dialog" onClick={onClose}><X size={17}/></button></div><form className="stack-form" onSubmit={e=>{e.preventDefault();onRun(asOf)}}><label>Billing cutoff date<input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)} required/></label><div className="billing-preview">{error ? <span className="field-error">{error}</span> : preview ? <><strong>{preview.due_count}</strong><span>active subscriptions due · {money(preview.estimated_total_minor)} est. total</span></> : <span>Checking subscriptions…</span>}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy||!preview||preview.due_count===0}>{busy?'Running…':'Create invoices'} <ArrowUpRight size={15}/></button></div></form></section></div>
}

function PaymentModal({ invoice, busy, onClose, onSubmit }) {
  const today = new Date().toISOString().slice(0, 10)
  return <div className="modal-backdrop"><section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title"><div className="modal-heading"><div><span className="form-icon green"><CreditCard size={16}/></span><div><h2 id="payment-title">Record a payment</h2><p>{invoice.number} · {invoice.customer_name}</p></div></div><button className="modal-close" aria-label="Close payment form" onClick={onClose}><X size={17}/></button></div><div className="payment-balance"><span>Remaining balance</span><strong>{money(invoice.balance_minor)}</strong></div><form className="stack-form" onSubmit={onSubmit}><label>Amount (₹)<input name="amount" type="number" min="0.01" max={(invoice.balance_minor / 100).toFixed(2)} step="0.01" defaultValue={(invoice.balance_minor / 100).toFixed(2)} required autoFocus/></label><div className="two-col"><label>Payment method<select name="method" defaultValue="Bank transfer"><option>Card</option><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Cheque</option></select></label><label>Payment date<input name="paid_at" type="date" defaultValue={today} required/></label></div><label>Note <span className="optional-label">Optional</span><textarea name="note" rows="2" placeholder="Reference or internal note"/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save payment'} <Check size={15}/></button></div></form></section></div>
}

function PageHeading({ eyebrow, title, desc, action }) { return <div className="page-heading"><div><div className="section-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{desc}</p></div>{action}</div> }
function Metric({ label, value, detail, icon: Icon, tone, foot }) { return <article className={`metric-card metric-${tone}`}><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={17}/></span></div><strong>{value}</strong><div className="metric-foot"><span>{detail || 'Current'}</span><span>{foot}</span></div></article> }

function Overview({ data, invoices, payments, subs, isStaff, busy, onRun, onView, onPay, onOpenInvoice, onOpenSubscription }) {
  const [activeTab, setActiveTab] = useState('Overdue invoices')
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
    const labelDate = new Date(today); labelDate.setDate(today.getDate() - daysAgo + 2)
    return { amount, label: labelDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }
  })
  const maxBar = Math.max(100, ...bins.map(bin => bin.amount))
  const statusCounts = data?.subscription_status_counts || {}
  const statusEntries = ['Draft','Quotation','Confirmed','Active','Closed'].map(status => ({ status, count: statusCounts[status] || 0 }))
  const tabContent = {
    'Overdue invoices': <InvoiceTable rows={data?.overdue_invoices || []} isStaff onPay={onPay} onOpen={onOpenInvoice} emptyMessage="There are no overdue invoices."/>,
    'Recent payments': <PaymentsTable rows={payments.slice(0,10)} emptyMessage="Payments will appear here when recorded."/>,
    'Active subscriptions': <SubscriptionTable rows={data?.active_subscription_rows || []} isStaff onOpen={onOpenSubscription} emptyMessage="There are no active subscriptions."/>,
  }
  return <><PageHeading eyebrow={todayLabel.toUpperCase()} title="Dashboard" desc="Finance overview of subscriptions, collections, taxes, and discounts." action={isStaff && <button className="primary-button" onClick={onRun} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''}/> Run billing</button>} />
    <div className="metric-grid"><Metric label="Active subscriptions" value={(data?.active_subscriptions || 0).toLocaleString()} detail="Live" foot="current portfolio" icon={RefreshCw} tone="blue"/><Metric label="Revenue collected" value={money(data?.revenue_minor)} detail="All payments" foot="recorded to date" icon={ArrowDownLeft} tone="violet"/><Metric label="Outstanding amount" value={money(data?.outstanding_minor)} detail="Open invoices" foot="remaining balance" icon={BadgeIndianRupee} tone="amber"/><Metric label="Overdue invoices" value={(data?.overdue_count || 0).toLocaleString()} detail={money(data?.overdue_amount_minor)} foot="past due amount" icon={FileText} tone="red"/></div>
    <div className="overview-grid"><section className="panel revenue-panel"><div className="panel-heading"><div><h2>Revenue collected</h2><p>Payments received over the last 30 days</p></div><span className="range-pill">Last 30 days</span></div><div className="chart-legend"><span><i className="legend-collected"/> Collected</span><strong>{money(data?.revenue_30d_minor)} <small>last 30 days</small></strong></div>{history.length ? <><div className="bar-chart"><div className="chart-y"><span>{money(maxBar)}</span><span>{money(maxBar / 2)}</span><span>₹0</span></div><div className="bars"><div className="bar-grid bg1"/><div className="bar-grid bg2"/><div className="bar-grid bg3"/>{bins.map((bin,i)=><div className="bar-pair" key={i} title={`${bin.label}: ${money(bin.amount)}`}><span style={{height:`${Math.max(3, bin.amount / maxBar * 86)}%`}}/><small>{bin.label}</small></div>)}</div></div><div className="chart-x"><span>30 days ago</span><span>Today</span></div></> : <div className="chart-empty"><span><Activity size={17}/></span><div><strong>No payments recorded in the last 30 days</strong><small>The collection trend will appear here after payments arrive.</small></div></div>}</section>
      <section className="panel renewals-panel"><div className="panel-heading"><div><h2>Subscriptions by status</h2><p>Current portfolio distribution</p></div></div><div className="status-chart">{statusEntries.map(item=><div className="status-chart-row" key={item.status}><span><StatusBadge status={item.status}/></span><div className="status-track"><i className={`status-fill status-fill-${item.status.toLowerCase()}`} style={{width:`${data?.active_subscriptions ? Math.max(3,item.count / Math.max(1,data.active_subscriptions) * 100) : 0}%`}}/></div><strong>{item.count}</strong></div>)}</div></section></div>
    <section className="panel table-panel dashboard-activity"><div className="activity-tabs" role="tablist" aria-label="Dashboard records">{Object.keys(tabContent).map(name=><button key={name} role="tab" aria-selected={activeTab===name} className={activeTab===name?'selected':''} onClick={()=>setActiveTab(name)}>{name}{name==='Overdue invoices'&&data?.overdue_count>0&&<span>{data.overdue_count}</span>}</button>)}</div><div className="panel-heading"><div><h2>{activeTab}</h2><p>{activeTab==='Overdue invoices'?'Invoices requiring follow-up':activeTab==='Recent payments'?'Latest recorded collections':'Upcoming recurring revenue'}</p></div><button className="text-button" onClick={()=>onView(activeTab==='Overdue invoices'?'Invoices':activeTab==='Recent payments'?'Payments':'Subscriptions')}>View all <ArrowUpRight size={14}/></button></div>{tabContent[activeTab]}</section>
  </>
}

function PaymentsTable({rows,emptyMessage}) { return <div className="table-wrap"><table><thead><tr><th>DATE</th><th>INVOICE</th><th>CUSTOMER</th><th>METHOD</th><th>AMOUNT</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{new Date(p.paid_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td><td><strong className="mono">{p.invoice_number}</strong></td><td>{p.customer_name}</td><td>{p.method}</td><td><MoneyCell value={p.amount_minor}/></td></tr>)}{!rows.length&&<tr><td colSpan="5"><Empty message={emptyMessage}/></td></tr>}</tbody></table></div>}
function InvoicePaymentTable({rows,emptyMessage}) { return <div className="table-wrap"><table><thead><tr><th>DATE</th><th>METHOD</th><th>AMOUNT</th><th>NOTE</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{new Date(p.paid_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td><td>{p.method}</td><td><MoneyCell value={p.amount_minor}/></td><td>{p.note||'—'}</td></tr>)}{!rows.length&&<tr><td colSpan="4"><Empty message={emptyMessage}/></td></tr>}</tbody></table></div>}
function StatusStepper({status}) {
  const steps=['Draft','Quotation','Confirmed','Active','Closed']
  const current=steps.indexOf(status)
  return <ol className="status-stepper" aria-label={`Subscription status: ${status}`}>{steps.map((step,index)=><li key={step} className={`${index<current?'complete':''} ${index===current?'current':''}`}><span>{index<current?<Check size={13}/>:index+1}</span><strong>{step}</strong></li>)}</ol>
}

function SubscriptionDetail({id,request,refresh,busy,onBack,onTransition,onOpenInvoice,onGenerateInvoice,isStaff}) {
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[confirmClose,setConfirmClose]=useState(false)
  useEffect(()=>{let live=true;setLoading(true);request(`/subscriptions/${id}`).then(value=>{if(live){setData(value);setError('')}}).catch(err=>{if(live)setError(err.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[id,request,refresh])
  if(loading)return <div className="panel detail-loading" role="status">Loading subscription…</div>
  if(error||!data)return <div className="panel detail-error" role="alert">{error||'Subscription not found'} <button className="secondary-button" onClick={onBack}>Back to subscriptions</button></div>
  const actions={Draft:[['Send quotation','Quotation']],Quotation:[['Back to draft','Draft'],['Confirm','Confirmed']],Confirmed:[['Activate','Active']],Active:[...(data.pausable?[['Pause','Paused']]:[]),...(data.closable?[['Close subscription','Closed']]:[])],Paused:[...(data.pausable?[['Resume','Active']]:[]),...(data.closable?[['Close subscription','Closed']]:[])],Closed:data.renewable?[['Renew','Renew']]:[]}[data.status]||[]
  async function renew(){try{await request(`/subscriptions/${id}/renew`,{method:'POST'});setData(await request(`/subscriptions/${id}`))}catch(err){setError(err.message)}}
  return <><PageHeading eyebrow="SUBSCRIPTION DETAIL" title={data.number} desc={`${data.customer_name} · ${data.plan_name}`} action={<div className="heading-actions"><StatusBadge status={data.status}/><button className="secondary-button" onClick={onBack}>Back to list</button>{isStaff&&data.status==='Active'&&<button className="secondary-button" disabled={busy} onClick={()=>onGenerateInvoice(id,false)}><FileText size={15}/> Create invoice</button>}{actions.map(([label,to])=><button className="primary-button" key={to} disabled={busy} onClick={()=>to==='Closed'?setConfirmClose(true):to==='Renew'?renew():onTransition(id,to)}>{label}</button>)}</div>}/><section className="panel detail-panel"><StatusStepper status={data.status}/><div className="detail-info-grid"><div><span className="detail-label">CUSTOMER</span><strong>{data.customer_name}</strong><small>{data.customer_email}</small><span className="detail-label">PLAN</span><strong>{data.plan_name}</strong><small>{data.product_name}</small><span className="detail-label">PAYMENT TERMS</span><strong>Net {data.payment_terms_days} days</strong><span className="detail-label">BILLING RULES</span><strong>{data.tax_name || 'Standard default tax'}</strong><small>{data.discount_name ? `Discount: ${data.discount_name}` : 'No discount override'}</small></div><div><span className="detail-label">START DATE</span><strong>{niceDate(data.start_date)}</strong><span className="detail-label">EXPIRY DATE</span><strong>{niceDate(data.expiry_date)}</strong><span className="detail-label">QUOTE VALID UNTIL</span><strong>{niceDate(data.quotation_expires_on)}</strong><span className="detail-label">NEXT INVOICE</span><strong>{niceDate(data.next_billing_date)}</strong><span className="detail-label">BILLING INTERVAL</span><strong>{data.billing_period}</strong></div></div><div className="detail-lines"><div className="panel-heading"><div><h2>Subscription lines</h2><p>Recurring products and quantities</p></div></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>QTY</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead><tbody>{(data.lines||[]).map(line=><tr key={line.id}><td>{line.product_name}<small className="cell-sub">{line.description}{line.variant?` · ${line.variant}`:''}</small></td><td>{line.quantity}</td><td><MoneyCell value={line.unit_price_minor}/></td><td><MoneyCell value={line.amount_minor}/></td></tr>)}</tbody></table></div><div className="detail-total"><span>Recurring net total (inc. rules)</span><strong>{money(data.amount_minor)} / {data.billing_period}</strong></div></div></section>{confirmClose&&<div className="modal-backdrop"><section className="payment-modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="close-title"><div className="modal-heading"><div><span className="form-icon red"><X size={16}/></span><div><h2 id="close-title">Close this subscription?</h2><p>It will stop future billing for {data.customer_name}.</p></div></div></div><div className="modal-actions"><button className="secondary-button" onClick={()=>setConfirmClose(false)}>Keep active</button><button className="danger-button" disabled={busy} onClick={()=>{setConfirmClose(false);onTransition(id,'Closed')}}>Close subscription</button></div></section></div>}
  <section className="panel table-panel detail-related"><div className="panel-heading"><div><h2>Invoices</h2><p>Billing history for this subscription</p></div></div><InvoiceTable rows={data.invoices||[]} isStaff onOpen={onOpenInvoice} emptyMessage="Invoices will appear here after billing."/></section></>
}

function InvoiceDetail({id,request,refresh,isStaff,onBack,onPay,onConfirm,onCancel,onRestore,onSend,busy}) {
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
  useEffect(()=>{let live=true;setLoading(true);request(`/invoices/${id}`).then(value=>{if(live){setData(value);setError('')}}).catch(err=>{if(live)setError(err.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[id,request,refresh])
  if(loading)return <div className="panel detail-loading" role="status">Loading invoice…</div>
  if(error||!data)return <div className="panel detail-error" role="alert">{error||'Invoice not found'} <button className="secondary-button" onClick={onBack}>Back to invoices</button></div>
  const status=data.status==='Paid'?'Paid':data.status==='Cancelled'?'Cancelled':data.status==='Draft'?'Draft':data.due_date < new Date().toISOString().slice(0,10)?'Overdue':data.status
  return <><PageHeading eyebrow="INVOICE DOCUMENT" title={data.number} desc={`Subscription ${data.subscription_number}`} action={<div className="heading-actions">
    <StatusBadge status={status}/>
    {isStaff && data.status === 'Cancelled' && <button className="primary-button" onClick={()=>onRestore(data.id)} disabled={busy}><RefreshCw size={15}/> Restore as draft</button>}
    {isStaff && data.status === 'Draft' && <button className="primary-button" onClick={()=>onConfirm(data.id)} disabled={busy}><Check size={15}/> Confirm invoice</button>}
    {isStaff && data.status === 'Confirmed' && <button className="primary-button" onClick={()=>onSend(data.id)} disabled={busy}><Send size={15}/> Send email</button>}
    {isStaff && data.status === 'Sent' && <button className="secondary-button" onClick={()=>onSend(data.id)} disabled={busy}><Mail size={15}/> Resend email</button>}
    {isStaff && (data.status === 'Confirmed' || data.status === 'Sent') && data.status !== 'Paid' && <button className="primary-button" onClick={()=>onPay(data)}><Plus size={15}/> Record payment</button>}
    {isStaff && data.status !== 'Paid' && data.status !== 'Cancelled' && <button className="secondary-button" onClick={()=>{if(window.confirm('Cancel this invoice? Any recorded payment prevents cancellation.'))onCancel(data.id)}} disabled={busy}><Ban size={15}/> Cancel invoice</button>}
    <button className="secondary-button" onClick={()=>window.print()}><FileText size={15}/> Print</button>
    <button className="secondary-button" onClick={onBack}>Back</button>
  </div>}/><article className="panel invoice-document"><div className="invoice-doc-top"><div className="invoice-wordmark"><span className="brand-mark"><Activity size={18}/></span><strong>brightloop<span>.</span></strong></div><div className="invoice-doc-number"><span>INVOICE</span><strong>{data.number}</strong></div></div><div className="invoice-parties"><div><span className="detail-label">FROM</span><strong>Brightloop Software</strong><small>billing@brightloop.example</small></div><div><span className="detail-label">BILL TO</span><strong>{data.customer?.name}</strong><small>{data.customer?.email}</small></div><div><span className="detail-label">ISSUED</span><strong>{niceDate(data.period_start)}</strong><span className="detail-label">DUE DATE</span><strong>{niceDate(data.due_date)}</strong><span className="detail-label">DELIVERY</span><small>{data.sent_at ? `Dispatch logged ${niceDate(data.sent_at)}` : 'Not dispatched yet'}</small></div></div><div className="table-wrap invoice-lines"><table><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE</th><th>TAX</th><th>AMOUNT</th></tr></thead><tbody>{data.lines.map(line=><tr key={line.id}><td>{line.description}<small className="cell-sub">{[line.product_name,line.variant_name].filter(Boolean).join(' · ')}</small></td><td>{line.quantity}</td><td><MoneyCell value={line.unit_price_minor}/></td><td><MoneyCell value={line.tax_minor}/></td><td><MoneyCell value={line.amount_minor}/></td></tr>)}</tbody></table></div><div className="invoice-totals">
    <div><span>Subtotal</span><MoneyCell value={data.subtotal_minor}/></div>
    {data.discount_amount_minor > 0 && <div className="discount-row"><span>Discount ({data.discount_name || 'Rule applied'})</span><MoneyCell value={-data.discount_amount_minor}/></div>}
    {data.discount_amount_minor > 0 && <div><span>Taxable net</span><MoneyCell value={data.subtotal_minor - data.discount_amount_minor}/></div>}
    <div><span>Tax ({data.tax_name || `${data.tax_rate_percent}%`})</span><MoneyCell value={data.tax_amount_minor}/></div>
    <div className="invoice-total"><strong>Total</strong><MoneyCell value={data.total_minor}/></div>
    <div><span>Amount paid</span><MoneyCell value={data.paid_minor}/></div>
    <div className="amount-due"><strong>Amount due</strong><MoneyCell value={data.balance_minor}/></div>
  </div>
  <section className="invoice-payments"><div className="panel-heading"><div><h2>Payments applied</h2><p>Recorded transactions towards this invoice</p></div></div><InvoicePaymentTable rows={data.payments||[]} emptyMessage="No payments recorded yet."/></section>
  <section className="invoice-deliveries"><div className="panel-heading"><div><h2>Dispatch log</h2><p>{data.deliveries?.some(d=>d.status==='Delivered')?'Email delivery history':'Email delivery is simulated until SMTP is configured.'}</p></div></div>
    {(data.deliveries && data.deliveries.length > 0) ? data.deliveries.map(d=><article key={d.id} className="delivery-card"><div className="delivery-header"><div><strong>{d.subject}</strong><small>To {d.recipient_email} · {niceDate(d.sent_at)}</small></div><span className="pill-auto">{d.status}</span></div><pre className="delivery-preview">{d.content_preview}</pre></article>) : <div className="empty-state"><span><Mail size={16}/></span>No dispatches have been logged for this invoice.</div>}
  </section>
  </article></>
}

function SearchBox({ value, onChange }) { return <label className="search-box"><Search size={16}/><input aria-label="Search records" placeholder="Search records…" value={value} onChange={e=>onChange(e.target.value)}/></label> }

function Subscriptions({ rows, isStaff, plans, customers, templates, taxes, discounts, busy, filter, setFilter, onCreate, page, onPage, onOpen }) {
  return <><PageHeading eyebrow="RECURRING BILLING" title={isStaff ? 'Subscriptions' : 'My subscriptions'} desc="Manage customer plans, billing cadence, and renewal dates." action={isStaff && <button className="primary-button" onClick={()=>document.getElementById('new-sub')?.scrollIntoView({behavior:'smooth'})}><Plus size={16}/> New subscription</button>}/>
    <div className="list-toolbar"><SearchBox value={filter} onChange={setFilter}/></div>
    <section className="panel table-panel"><SubscriptionTable rows={rows} isStaff={isStaff} onOpen={onOpen}/></section><Pagination page={page} onPage={onPage}/>
    {isStaff && <section className="panel form-panel" id="new-sub"><div className="form-title"><div><span className="form-icon blue"><Plus size={16}/></span><div><h2>Create a subscription</h2><p>Assign a plan or quotation template and set its dates.</p></div></div></div><form className="form-grid" onSubmit={e=>onCreate(e,'/subscriptions')}><label>Customer<select name="customer_id" required defaultValue="">{customers.map(c=><option value={c.id} key={c.id}>{c.name} · {c.email}</option>)}</select></label><label>Primary plan<select name="plan_id" required defaultValue="">{plans.map(p=><option value={p.id} key={p.id}>{p.name} · {money(p.price_minor)}/{p.billing_period}</option>)}</select></label><label>Quotation template <span className="optional-label">Optional</span><select name="template_id" defaultValue=""><option value="">Start without a template</option>{templates.map(t=><option value={t.id} key={t.id}>{t.name} · valid {t.validity_days} days</option>)}</select></label><label>Tax rule <span className="optional-label">Optional</span><select name="tax_id" defaultValue=""><option value="">Default tax rule</option>{(taxes||[]).filter(t=>t.active).map(t=><option value={t.id} key={t.id}>{t.name} ({t.rate_percent}%){t.is_default ? ' · Default' : ''}</option>)}</select></label><label>Discount rule <span className="optional-label">Optional</span><select name="discount_id" defaultValue=""><option value="">Auto-apply discount</option>{(discounts||[]).filter(d=>d.active).map(d=><option value={d.id} key={d.id}>{d.name} ({d.discount_type === 'percentage' ? `${d.value}%` : `₹${d.value}`}){d.auto_apply ? ' · Auto' : ''}</option>)}</select></label><label>Start date<input name="start_date" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></label><label>Expiry date <span className="optional-label">Optional</span><input name="expiry_date" type="date"/></label><label>Seats / quantity<input name="quantity" type="number" min="1" defaultValue="1" required/></label><label>Payment terms (days)<input name="payment_terms_days" type="number" min="0" defaultValue="14"/></label><div className="form-submit"><button className="primary-button" disabled={busy}>Create subscription <ArrowUpRight size={15}/></button></div></form></section>}
  </>
}
function SubscriptionTable({rows,isStaff,onOpen,emptyMessage="No subscriptions match your search"}) { return <div className="table-wrap"><table><thead><tr><th>SUBSCRIPTION</th>{isStaff&&<th>CUSTOMER</th>}<th>PLAN</th><th>AMOUNT</th><th>RENEWAL</th><th>STATUS</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><button className="link-button mono" onClick={()=>onOpen?.(r.id)}>{r.number}</button><small className="cell-sub">Started {niceDate(r.start_date)}</small></td>{isStaff&&<td>{r.customer_name}</td>}<td>{r.plan_name}<small className="cell-sub">{r.quantity} seats · {r.payment_terms_days} day terms</small></td><td><strong>{money(r.amount_minor)}</strong><small className="cell-sub">per billing period</small></td><td>{niceDate(r.next_billing_date)}</td><td><StatusBadge status={r.status}/></td></tr>)}{!rows.length&&<tr><td colSpan="6"><Empty message={emptyMessage}/></td></tr>}</tbody></table></div> }

function Invoices({ rows, rawInvoices, isStaff, busy, filter, setFilter, statusFilter, setStatusFilter, onPay, onRun, onConfirm, onSend, onOpen, page, onPage }) {
  const tabs = ['All', 'Draft', 'Confirmed', 'Sent', 'Paid', 'Cancelled', 'Overdue']
  return <><PageHeading eyebrow="BILLING & COLLECTIONS" title={isStaff ? 'Invoices' : 'My invoices'} desc="Track invoices, payments, tax rules, and delivery statuses." action={isStaff&&<div className="heading-actions"><button className="secondary-button" onClick={onRun}><RefreshCw size={15}/> Run billing</button><button className="secondary-button" onClick={()=>window.print()}><FileText size={15}/> Print report</button></div>}/>
    <div className="filter-tabs">{tabs.map(tab => {
      const count = tab === 'All' ? (rawInvoices || []).length : tab === 'Overdue' ? (rawInvoices || []).filter(i => i.status !== 'Paid' && i.status !== 'Cancelled' && i.due_date < new Date().toISOString().slice(0, 10)).length : (rawInvoices || []).filter(i => i.status === tab).length
      return <button key={tab} className={statusFilter === tab ? 'active' : ''} onClick={()=>setStatusFilter(tab)}>{tab}<span>({count})</span></button>
    })}</div>
    <div className="list-toolbar"><SearchBox value={filter} onChange={setFilter}/></div>
    <section className="panel table-panel"><InvoiceTable rows={rows} isStaff={isStaff} onPay={onPay} onConfirm={onConfirm} onSend={onSend} onOpen={onOpen}/></section><Pagination page={page} onPage={onPage}/></>
}

function InvoiceTable({rows,isStaff,onPay,onConfirm,onSend,onOpen,emptyMessage="Invoices appear here after billing runs"}) { return <div className="table-wrap"><table><thead><tr><th>INVOICE</th>{isStaff&&<th>CUSTOMER</th>}<th>ISSUED / DUE</th><th>SUBTOTAL / TAX</th><th>TOTAL</th><th>STATUS</th>{isStaff&&<th>ACTIONS</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><button className="link-button mono" onClick={()=>onOpen?.(r.id)}>{r.number}</button><small className="cell-sub">Subscription {r.subscription_id}</small></td>{isStaff&&<td>{r.customer_name}</td>}<td>{niceDate(r.period_start)}<small className="cell-sub">Due {niceDate(r.due_date)}</small></td><td>{money(r.subtotal_minor)}<small className="cell-sub">Tax: {money(r.tax_amount_minor)}</small></td><td><strong>{money(r.total_minor)}</strong>{r.balance_minor>0&&<small className="cell-sub">{money(r.balance_minor)} due</small>}</td><td><StatusBadge status={r.status === 'Paid' ? 'Paid' : r.status === 'Cancelled' ? 'Cancelled' : r.status === 'Draft' ? 'Draft' : r.due_date < new Date().toISOString().slice(0,10) ? 'Overdue' : r.status}/></td>{isStaff&&<td>
  <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
    {r.status === 'Draft' && <button className="table-action" onClick={()=>onConfirm?.(r.id)} title="Confirm invoice"><Check size={13}/> Confirm</button>}
    {r.status === 'Confirmed' && <button className="table-action" onClick={()=>onSend?.(r.id)} title="Log invoice email dispatch"><Send size={13}/> Send</button>}
    {r.status === 'Sent' && <button className="table-action" onClick={()=>onSend?.(r.id)} title="Log another invoice email dispatch"><Mail size={13}/> Resend</button>}
    {(r.status === 'Sent' || r.status === 'Confirmed' || (r.status !== 'Paid' && r.status !== 'Cancelled')) && r.status !== 'Paid' && r.status !== 'Draft' && <button className="table-action" onClick={()=>onPay(r)} title="Record payment"><Plus size={13}/> Pay</button>}
  </div>
</td>}</tr>)}{!rows.length&&<tr><td colSpan="7"><Empty message={emptyMessage}/></td></tr>}</tbody></table></div> }

function BillingRules({ taxes, discounts, products, busy, onToggleTax, onToggleDiscount, onCreate, isAdmin }) {
  return <>
    <PageHeading eyebrow="AUTOMATION & RULES" title="Billing rules" desc="Configure tax percentages and discount rules automatically applied during subscription billing runs."/>
    <div className="rules-grid">
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Tax rules</h2><p>Applied to billable subtotal</p></div></div>
        <div className="rule-list">
          {taxes.map(t => <div key={t.id} className="rule-item">
            <div className="rule-meta">
              <strong>{t.name}</strong>
              <small>{t.rate_percent}% tax rate</small>
            </div>
            <div className="rule-actions">
              {t.is_default && <span className="pill-default">Default</span>}
              {isAdmin && <button className="toggle-btn" disabled={busy} onClick={()=>onToggleTax(t.id)}>{t.active ? 'Active' : 'Inactive'}</button>}
            </div>
          </div>)}
          {!taxes.length && <Empty message="No tax rules configured"/>}
        </div>
        {isAdmin && <div className="form-panel" style={{borderTop:'1px solid #E3E8EE',marginTop:'12px'}}>
          <div className="form-title"><div><span className="form-icon blue"><Percent size={16}/></span><div><h2>Add tax rule</h2><p>Define rate & default application</p></div></div></div>
          <form className="stack-form" onSubmit={e=>onCreate(e, '/taxes')}>
            <label>Tax name<input name="name" required placeholder="e.g. GST 18%, VAT 5%"/></label>
            <label>Rate percentage (%)<input name="rate_percent" type="number" step="0.01" min="0" max="100" required placeholder="18.0"/></label>
            <label><input type="checkbox" name="is_default"/> Set as default tax for new billings</label>
            <button className="primary-button" disabled={busy}>Add tax rule <Plus size={15}/></button>
          </form>
        </div>}
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Discount rules</h2><p>Percentage or flat currency deductions</p></div></div>
        <div className="rule-list">
          {discounts.map(d => <div key={d.id} className="rule-item">
            <div className="rule-meta">
              <strong>{d.name}</strong>
              <small>{d.discount_type === 'percentage' ? `${d.value}% off` : `₹${d.value} flat discount`} · {d.scope === 'product' ? (d.product_name || 'Selected product') : 'Whole subscription'} · min {money(d.min_amount_minor)} / {d.min_qty} qty{d.code ? ` · Code: ${d.code}` : ''}</small>
              <small>{d.starts_on || 'No start'} → {d.ends_on || 'No end'} · Uses {d.used_count}{d.usage_limit ? ` / ${d.usage_limit}` : ' · unlimited'}</small>
            </div>
            <div className="rule-actions">
              {d.auto_apply && <span className="pill-auto">Auto-apply</span>}
              {isAdmin && <button className="toggle-btn" disabled={busy} onClick={()=>onToggleDiscount(d.id)}>{d.active ? 'Active' : 'Inactive'}</button>}
            </div>
          </div>)}
          {!discounts.length && <Empty message="No discount rules configured"/>}
        </div>
        {isAdmin && <div className="form-panel" style={{borderTop:'1px solid #E3E8EE',marginTop:'12px'}}>
          <div className="form-title"><div><span className="form-icon green"><Tag size={16}/></span><div><h2>Add discount rule</h2><p>Define deduction type & auto-apply</p></div></div></div>
          <form className="stack-form" onSubmit={e=>onCreate(e, '/discounts')}>
            <label>Discount name<input name="name" required placeholder="e.g. Early Bird 10%"/></label>
            <div className="two-col">
              <label>Discount type<select name="discount_type" defaultValue="percentage"><option value="percentage">Percentage (%)</option><option value="fixed">Fixed amount (₹)</option></select></label>
              <label>Discount value<input name="value" type="number" step="0.01" min="0" required placeholder="10.0"/></label>
            </div>
            <div className="two-col"><label>Scope<select name="scope" defaultValue="subscription"><option value="subscription">Whole subscription</option><option value="product">Specific product</option></select></label><label>Product<select name="product_id" defaultValue=""><option value="">Choose if product-scoped</option>{products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label></div>
            <div className="two-col"><label>Minimum purchase (₹)<input name="min_amount_minor" type="number" min="0" step="0.01" defaultValue="0"/></label><label>Minimum quantity<input name="min_qty" type="number" min="1" defaultValue="1"/></label></div>
            <div className="two-col"><label>Starts on<input name="starts_on" type="date"/></label><label>Ends on<input name="ends_on" type="date"/></label></div>
            <label>Usage limit <span className="optional-label">Blank means unlimited</span><input name="usage_limit" type="number" min="1" placeholder="e.g. 100"/></label>
            <label>Promo code <span className="optional-label">Optional</span><input name="code" placeholder="e.g. LAUNCH10"/></label>
            <label><input type="checkbox" name="auto_apply"/> Auto-apply to new billings</label>
            <button className="primary-button" disabled={busy}>Add discount rule <Plus size={15}/></button>
          </form>
        </div>}
      </section>
    </div>
  </>
}

function Customers({rows,busy,onCreate,page,onPage}) {
  return <><PageHeading eyebrow="CUSTOMER DIRECTORY" title="Customers" desc="The people and teams behind your recurring revenue."/><div className="content-split"><section className="panel table-panel"><div className="panel-heading"><div><h2>All customers</h2><p>{page?.total || rows.length} customer accounts</p></div></div><div className="customer-list">{rows.map((c,i)=><div className="customer-full-row" key={c.id}><div className={`customer-initial initial-${i%4}`}>{c.name[0]}</div><div><strong>{c.name}</strong><small>{c.email}</small></div><span className="customer-tag">Customer</span></div>)}{!rows.length&&<Empty message="No customer accounts yet"/>}</div><Pagination page={page} onPage={onPage}/></section><section className="panel form-panel compact-form"><div className="form-title"><div><span className="form-icon violet"><Users size={16}/></span><div><h2>Add a customer</h2><p>Create a billing contact.</p></div></div></div><form className="stack-form" onSubmit={e=>onCreate(e,'/customers')}><label>Company or customer name<input name="name" required placeholder="e.g. Acme Studio"/></label><label>Billing email<input name="email" type="email" required placeholder="billing@company.com"/></label><button className="primary-button" disabled={busy}>Add customer <Plus size={15}/></button></form></section></div></>
}

function Catalog({products,plans,isAdmin,busy,onCreate,pageInfo,onPage,view}) {
  const showingProducts = view === 'Products'
  const rows = showingProducts ? products : plans
  const pageKey = showingProducts ? 'products' : 'plans'
  return <><PageHeading eyebrow="CATALOG" title={view} desc={showingProducts ? "Manage products and their pricing." : "Set recurring prices and billing intervals."}/><div className="catalog-grid">
    {showingProducts ? <section className="panel form-panel"><div className="form-title"><div><span className="form-icon blue"><CreditCard size={16}/></span><div><h2>New product</h2><p>Define a product and its list price.</p></div></div></div>{isAdmin?<form className="stack-form" onSubmit={e=>onCreate(e,'/products')}><label>Product name<input name="name" required placeholder="Brightloop Analytics"/></label><div className="two-col"><label>Sales price (₹)<input name="price_minor" type="number" min="0" step="0.01" required/></label><label>Cost price (₹)<input name="cost_minor" type="number" min="0" step="0.01" defaultValue="0"/></label></div><label>Variants <span className="optional-label">One per line: Attribute=Value|Extra ₹</span><textarea name="variants_text" rows="3" placeholder={"Brand=Odoo|560\nBrand=Acme|0"}/></label><label>Notes<textarea name="notes" rows="2" placeholder="A short product description"/></label><button className="primary-button" disabled={busy}>Create product <Plus size={15}/></button></form>:<div className="permission-note"><ShieldCheck size={16}/> Product changes are limited to admins.</div>}</section> : <section className="panel form-panel"><div className="form-title"><div><span className="form-icon green"><RefreshCw size={16}/></span><div><h2>New plan</h2><p>Choose a product, price, and billing cadence.</p></div></div></div>{isAdmin?<form className="stack-form" onSubmit={e=>onCreate(e,'/plans')}><label>Plan name<input name="name" required placeholder="Growth · Monthly"/></label><label>Product<select name="product_id" required defaultValue="">{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="two-col"><label>Price (₹)<input name="price_minor" type="number" min="0" step="0.01" required/></label><label>Billing interval<select name="billing_period"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label></div><label>Minimum quantity<input name="min_qty" type="number" min="1" defaultValue="1"/></label><div className="two-col"><label>Available from<input name="available_from" type="date"/></label><label>Available until<input name="available_until" type="date"/></label></div><div className="plan-flags"><label><input type="checkbox" name="auto_close"/> Auto-close at end date</label><label><input type="checkbox" name="closable" defaultChecked/> Allow early close</label><label><input type="checkbox" name="pausable"/> Allow pause</label><label><input type="checkbox" name="renewable" defaultChecked/> Allow renewal</label></div><button className="primary-button" disabled={busy}>Create plan <Plus size={15}/></button></form>:<div className="permission-note"><ShieldCheck size={16}/> Plan changes are limited to admins.</div>}</section>}
    <section className="panel table-panel catalog-table"><div className="panel-heading"><div><h2>{showingProducts?'Products':'Available plans'}</h2><p>{pageInfo?.[pageKey]?.total || rows.length} records</p></div></div>{showingProducts ? <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SALES PRICE</th><th>COST</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small className="cell-sub">{p.notes || '—'}</small>{p.variants?.map(v=><small className="cell-sub" key={v.id}>{v.attribute}: {v.value} (+{money(v.extra_price_minor)})</small>)}</td><td><MoneyCell value={p.price_minor}/></td><td><MoneyCell value={p.cost_minor}/></td></tr>)}{!rows.length&&<tr><td colSpan="3"><Empty message="Create a product to add it to your catalog"/></td></tr>}</tbody></table></div> : <div className="plan-cards">{rows.map((p,i)=><div className="plan-card" key={p.id}><div className={`plan-icon pi-${i%3}`}><CreditCard size={17}/></div><div className="plan-name"><strong>{p.name}</strong><small>{p.product_name} · minimum {p.min_qty}</small></div><div className="plan-price"><MoneyCell value={p.price_minor}/><small>per {p.billing_period}</small></div><StatusBadge status="Active"/></div>)}{!rows.length&&<Empty message="Add a product and plan to get started"/>}</div>}<Pagination page={pageInfo?.[pageKey]} onPage={page=>onPage(pageKey,page)}/></section>
  </div></>
}

function Templates({templates,products,plans,busy,onCreate}) {
  const [lines,setLines]=useState([{product_id:'',plan_id:'',variant_id:'',description:'',quantity:1,price:''}])
  function changeLine(index,key,value){setLines(current=>current.map((line,i)=>i===index?{...line,[key]:value}:line))}
  function save(event){event.preventDefault();const form=new FormData(event.currentTarget);const body={name:String(form.get('name')||''),validity_days:Number(form.get('validity_days')||30),lines:lines.map(line=>{const product=products.find(p=>p.id===Number(line.product_id));const plan=plans.find(p=>p.id===Number(line.plan_id));return {product_id:Number(line.product_id),plan_id:line.plan_id?Number(line.plan_id):null,variant_id:line.variant_id?Number(line.variant_id):null,description:line.description||plan?.name||product?.name||'Subscription line',quantity:Number(line.quantity||1),unit_price_minor:Math.round(Number(line.price||0)*100)}})};onCreate(body)}
  return <><PageHeading eyebrow="SALES SETUP" title="Quotation templates" desc="Start subscriptions from reusable product and plan lines."/><div className="content-split"><section className="panel form-panel"><div className="form-title"><div><span className="form-icon violet"><FileText size={16}/></span><div><h2>New template</h2><p>Set its validity and reusable billing lines.</p></div></div></div><form className="stack-form" onSubmit={save}><label>Template name<input name="name" required placeholder="Annual enterprise offer"/></label><label>Validity (days)<input name="validity_days" type="number" min="1" max="365" defaultValue="30" required/></label>{lines.map((line,index)=><div className="template-line" key={index}><div className="template-line-title"><strong>Line {index+1}</strong>{lines.length>1&&<button type="button" className="text-button" onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>Remove</button>}</div><label>Product<select required value={line.product_id} onChange={e=>{changeLine(index,'product_id',e.target.value);changeLine(index,'variant_id','')}}><option value="">Choose a product</option>{products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>Variant<select value={line.variant_id} onChange={e=>{changeLine(index,'variant_id',e.target.value);const product=products.find(p=>p.id===Number(line.product_id));const variant=product?.variants?.find(v=>v.id===Number(e.target.value));const plan=plans.find(p=>p.id===Number(line.plan_id));if(variant)changeLine(index,'price',String(((plan?.price_minor||product?.price_minor||0)+variant.extra_price_minor)/100))}}><option value="">No variant</option>{(products.find(p=>p.id===Number(line.product_id))?.variants||[]).map(v=><option value={v.id} key={v.id}>{v.attribute}: {v.value} (+{money(v.extra_price_minor)})</option>)}</select></label><label>Plan<select value={line.plan_id} onChange={e=>{changeLine(index,'plan_id',e.target.value);const p=plans.find(plan=>plan.id===Number(e.target.value));const product=products.find(item=>item.id===Number(line.product_id));const variant=product?.variants?.find(v=>v.id===Number(line.variant_id));if(p||product)changeLine(index,'price',String(((p?.price_minor||product?.price_minor||0)+(variant?.extra_price_minor||0))/100))}}><option value="">No recurring plan</option>{plans.map(p=><option value={p.id} key={p.id}>{p.name} · {p.billing_period}</option>)}</select></label><label>Description<input value={line.description} onChange={e=>changeLine(index,'description',e.target.value)} placeholder="Optional line description"/></label><div className="two-col"><label>Quantity<input type="number" min="1" value={line.quantity} onChange={e=>changeLine(index,'quantity',e.target.value)}/></label><label>Unit price (₹)<input type="number" min="0" step="0.01" value={line.price} onChange={e=>changeLine(index,'price',e.target.value)} required/></label></div></div>)}<button type="button" className="secondary-button" onClick={()=>setLines(current=>[...current,{product_id:'',plan_id:'',variant_id:'',description:'',quantity:1,price:''}])}><Plus size={15}/> Add line</button><button className="primary-button" disabled={busy||!products.length}>Create template <ArrowUpRight size={15}/></button></form></section><section className="panel table-panel"><div className="panel-heading"><div><h2>Saved templates</h2><p>{templates.length} available</p></div></div>{templates.map(t=><article className="template-card" key={t.id}><div><strong>{t.name}</strong><small>Valid for {t.validity_days} days · {t.lines.length} line(s)</small></div><ul>{t.lines.map(line=><li key={line.id}>{line.description}{line.variant_name?` · ${line.variant_name}`:''} · {line.quantity} × {money(line.unit_price_minor)}</li>)}</ul></article>)}{!templates.length&&<Empty message="No quotation templates yet"/>}</section></div></>
}

function Payments({rows,page,onPage}) {
  return <><PageHeading eyebrow="COLLECTIONS" title="Payments" desc="A record of payments applied to customer invoices."/><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>DATE</th><th>INVOICE</th><th>CUSTOMER</th><th>METHOD</th><th>AMOUNT</th><th>NOTE</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{new Date(p.paid_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td><td><strong className="mono">{p.invoice_number}</strong></td><td>{p.customer_name}</td><td>{p.method}</td><td><MoneyCell value={p.amount_minor}/></td><td>{p.note || '—'}</td></tr>)}{!rows.length&&<tr><td colSpan="6"><Empty message="Recorded payments will appear here"/></td></tr>}</tbody></table></div></section><Pagination page={page} onPage={onPage}/></>
}

function MoneyCell({value}) { return <span className="money-cell">{money(value)}</span> }
function Pagination({page,onPage}) {
  if (!page || page.total <= page.page_size) return null
  const pages = Math.ceil(page.total / page.page_size)
  return <div className="pagination"><span>Showing {(page.page-1)*page.page_size+1}–{Math.min(page.page*page.page_size,page.total)} of {page.total}</span><div><button className="secondary-button" onClick={()=>onPage(page.page-1)} disabled={page.page<=1}>Previous</button><span>Page {page.page} of {pages}</span><button className="secondary-button" onClick={()=>onPage(page.page+1)} disabled={page.page>=pages}>Next</button></div></div>
}
function StatusBadge({status}) {
  const normalized = status === 'Awaiting payment' ? 'Outstanding' : status
  const className = normalized.toLowerCase().replaceAll(' ','-')
  return <span className={`status-badge status-${className}`}>{normalized}</span>
}

function Empty({message}) {return <div className="empty-state"><span><FileText size={18}/></span>{message}</div>}

export default App
