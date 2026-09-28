from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db.init_db import get_engine
from backend.db.schema import Merchant

router = APIRouter(prefix="/api/merchants", tags=["merchants"])


def get_db():
    engine = get_engine()
    with Session(engine) as session:
        yield session


@router.get("")
def list_merchants(db: Session = Depends(get_db)):
    merchants = db.query(Merchant).all()
    return [
        {
            "merchant_id": m.merchant_id,
            "merchant_name": m.merchant_name,
            "trust_status": m.trust_status,
            "tier": m.tier,
        }
        for m in merchants
    ]


@router.get("/{merchant_id}")
def get_merchant(merchant_id: str, db: Session = Depends(get_db)):
    m = db.query(Merchant).filter_by(merchant_id=merchant_id).first()
    if not m:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Merchant not found")
    return {
        "merchant_id": m.merchant_id,
        "merchant_name": m.merchant_name,
        "trust_status": m.trust_status,
        "tier": m.tier,
    }
