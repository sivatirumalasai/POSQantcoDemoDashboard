from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views

urlpatterns = [
    path("health/", views.health),
    path("ingest/", views.ingest),
    path("reports/sales", views.reports_sales),
    path("auth/token", TokenObtainPairView.as_view()),
    path("auth/refresh", TokenRefreshView.as_view()),
]
